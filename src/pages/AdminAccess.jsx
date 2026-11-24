import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clock,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { getClientProfile } from "../lib/auth.js";
import { isOwnerAccount } from "../lib/messages.js";
import {
  adminApplicationStatusLabel,
  formatAdminApplicationDate,
  getAdminApplicationErrorMessage,
  getMyAdminApplication,
  hasAdminAccess,
  isMissingAdminAccessError,
  listAdminApplications,
  maximumAdminReasonLength,
  reviewAdminApplication,
  submitAdminApplication,
  validateAdminReason,
} from "../lib/adminAccess.js";

function resolveApplicantName(user, profile) {
  const candidates = [
    profile?.full_name,
    profile?.username,
    user?.user_metadata?.full_name,
    user?.user_metadata?.name,
  ];
  const name = candidates.find((value) => typeof value === "string" && value.trim());
  return name ? name.trim() : "";
}

function StatusPill({ status }) {
  return <span className={`admin-access-pill is-${status}`}>{adminApplicationStatusLabel(status)}</span>;
}

export default function AdminAccess() {
  const { user } = useAuth();

  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [hasAccess, setHasAccess] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [application, setApplication] = useState(null);

  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [submitState, setSubmitState] = useState("idle");
  const [formError, setFormError] = useState("");
  const [submitError, setSubmitError] = useState("");

  const [applications, setApplications] = useState([]);
  const [listState, setListState] = useState("idle");
  const [listError, setListError] = useState("");
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewReason, setReviewReason] = useState("");
  const [reviewState, setReviewState] = useState("idle");
  const [reviewError, setReviewError] = useState("");
  const [notice, setNotice] = useState("");

  const userId = user?.id;

  const load = useCallback(async () => {
    if (!userId) return;
    setStatus("loading");
    setLoadError("");
    try {
      const [access, owner, myApplication, loadedProfile] = await Promise.all([
        hasAdminAccess(),
        isOwnerAccount().catch(() => false),
        getMyAdminApplication(userId).catch((error) => {
          if (isMissingAdminAccessError(error)) return null;
          throw error;
        }),
        getClientProfile(userId).catch(() => null),
      ]);

      setHasAccess(access);
      setIsOwner(owner);
      setApplication(myApplication);
      setName((current) => current || resolveApplicantName(user, loadedProfile));
      setStatus("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Admin access information could not be loaded.");
      setStatus("error");
    }
  }, [userId, user]);

  useEffect(() => { void load(); }, [load]);

  const loadOwnerApplications = useCallback(async () => {
    setListState("loading");
    setListError("");
    try {
      setApplications(await listAdminApplications());
      setListState("ready");
    } catch (error) {
      setListError(getAdminApplicationErrorMessage(error));
      setListState("error");
    }
  }, []);

  useEffect(() => {
    if (status === "ready" && isOwner) void loadOwnerApplications();
  }, [status, isOwner, loadOwnerApplications]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitState === "submitting") return;

    const applicantName = name.trim();
    if (!applicantName) {
      setFormError("Enter the name to show on your application.");
      return;
    }
    if (applicantName.length > 120) {
      setFormError("Your name must be 120 characters or fewer.");
      return;
    }

    const validatedReason = validateAdminReason(reason);
    if (validatedReason.error) {
      setFormError(validatedReason.error);
      return;
    }

    setFormError("");
    setSubmitError("");
    setSubmitState("submitting");
    try {
      const created = await submitAdminApplication({ applicantName, reason: validatedReason.value });
      setApplication(created);
      setReason("");
      setSubmitState("success");
    } catch (error) {
      setSubmitError(getAdminApplicationErrorMessage(error));
      setSubmitState("error");
    }
  };

  const openReview = (target, decision) => {
    setReviewTarget({ applicationId: target.id, decision, applicant: target });
    setReviewReason("");
    setReviewError("");
    setReviewState("idle");
  };

  const handleReview = async (event) => {
    event.preventDefault();
    if (!reviewTarget || reviewState === "submitting") return;

    const cleanReason = reviewReason.trim();
    if (cleanReason.length > maximumAdminReasonLength) {
      setReviewError("The decision note must be 2,000 characters or fewer.");
      return;
    }

    setReviewState("submitting");
    setReviewError("");
    try {
      const updated = await reviewAdminApplication({
        applicationId: reviewTarget.applicationId,
        decision: reviewTarget.decision,
        reason: cleanReason,
      });
      setApplications((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setApplication((current) => (current && current.id === updated.id ? updated : current));
      setNotice(`${updated.applicant_name}'s application was marked ${adminApplicationStatusLabel(updated.status).toLowerCase()}.`);
      setReviewTarget(null);
      setReviewReason("");
      setReviewState("idle");
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The decision could not be saved.");
      setReviewState("error");
    }
  };

  if (status === "loading") {
    return (
      <main className="admin-access">
        <section className="admin-access-panel admin-access-status" aria-live="polite">
          <span className="admin-access-icon"><Loader2 className="admin-access-spinner" size={22} aria-hidden="true" /></span>
          <h1>Checking admin access…</h1>
          <p>Confirming your access on the server. This only takes a moment.</p>
        </section>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="admin-access">
        <section className="admin-access-panel admin-access-status is-error" aria-live="polite">
          <span className="admin-access-icon"><AlertTriangle size={22} aria-hidden="true" /></span>
          <h1>Admin access is unavailable</h1>
          <p>{loadError}</p>
          <button className="admin-access-button is-secondary" type="button" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </section>
      </main>
    );
  }

  const showApplyForm = !hasAccess && (!application || application.status === "rejected");

  return (
    <main className="admin-access">
      <header className="admin-access-heading">
        <span className="market-eyebrow">NEXTECH · ADMIN ACCESS</span>
        <h1>Admin access</h1>
        <p>
          Admin access is granted only by the NexTech owner. Applying never changes your account
          role or the owner list — approved admins are recorded separately and verified on the server.
        </p>
      </header>

      {notice && (
        <div className="admin-access-notice" role="status">
          <BadgeCheck size={16} aria-hidden="true" />{notice}
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={14} /></button>
        </div>
      )}

      {hasAccess && (
        <section className="admin-access-panel admin-access-card is-granted">
          <span className="admin-access-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
          <h2>{isOwner ? "You are the NexTech owner" : "Admin access granted"}</h2>
          <p>
            {isOwner
              ? "The owner always has full admin access. You can also review admin applications below."
              : "Your application was approved. You can now open the admin dashboard."}
          </p>
          <Link className="admin-access-button" to="/admin">Open admin dashboard</Link>
        </section>
      )}

      {!hasAccess && application?.status === "pending" && (
        <section className="admin-access-panel admin-access-card is-pending">
          <span className="admin-access-icon"><Clock size={22} aria-hidden="true" /></span>
          <h2>Application pending review</h2>
          <p>Your application is waiting for the NexTech owner. You cannot submit another one until it is reviewed.</p>
          <dl className="admin-access-summary">
            <div><dt>Status</dt><dd><StatusPill status="pending" /></dd></div>
            <div><dt>Submitted</dt><dd>{formatAdminApplicationDate(application.created_at)}</dd></div>
            <div><dt>Name</dt><dd>{application.applicant_name}</dd></div>
            <div><dt>Reason</dt><dd>{application.reason}</dd></div>
          </dl>
        </section>
      )}

      {!hasAccess && application?.status === "approved" && (
        <section className="admin-access-panel admin-access-card is-approved">
          <span className="admin-access-icon"><BadgeCheck size={22} aria-hidden="true" /></span>
          <h2>Application approved</h2>
          <p>You now have admin access. Open the admin dashboard to continue.</p>
          <Link className="admin-access-button" to="/admin">Open admin dashboard</Link>
        </section>
      )}

      {showApplyForm && (
        <section className="admin-access-panel">
          {application?.status === "rejected" && (
            <div className="admin-access-rejected" role="status">
              <span><X size={15} aria-hidden="true" /> Previous application rejected</span>
              {application.decision_reason && <p>{application.decision_reason}</p>}
              <p className="admin-access-rejected-note">You may submit a new application below.</p>
            </div>
          )}

          <h2 className="admin-access-form-title">Apply for admin access</h2>
          <p className="admin-access-form-intro">
            Your name and email are taken from your signed-in account, and the application is stored
            against your verified identity.
          </p>

          {submitState === "success" ? (
            <div className="admin-access-success" role="status">
              <span><Check size={16} aria-hidden="true" /></span>
              <div>
                <strong>Application submitted</strong>
                <p>Your request is now pending review by the NexTech owner.</p>
              </div>
            </div>
          ) : (
            <form className="admin-access-form" onSubmit={handleSubmit}>
              <label>
                Applicant name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Email
                <input value={user?.email ?? ""} readOnly aria-readonly="true" tabIndex={-1} />
              </label>
              <label>
                Reason for requesting admin access
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={5}
                  maxLength={maximumAdminReasonLength}
                  placeholder="Explain what you need to manage and why."
                  required
                />
                <small className="admin-access-counter">{reason.trim().length}/{maximumAdminReasonLength}</small>
              </label>

              {formError && <p className="admin-access-error" role="alert">{formError}</p>}
              {submitError && <p className="admin-access-error" role="alert">{submitError}</p>}

              <div className="admin-access-actions">
                <button className="admin-access-button" type="submit" disabled={submitState === "submitting"}>
                  <Send size={14} aria-hidden="true" />
                  {submitState === "submitting" ? "Submitting…" : "Submit application"}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {isOwner && (
        <section className="admin-access-panel admin-access-review">
          <div className="admin-access-review-head">
            <div>
              <span className="market-eyebrow">OWNER ONLY</span>
              <h2>Admin applications</h2>
            </div>
            <button
              className="admin-access-button is-secondary"
              type="button"
              onClick={() => void loadOwnerApplications()}
              disabled={listState === "loading"}
            >
              <RefreshCw size={14} aria-hidden="true" /> {listState === "loading" ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {listState === "error" && <p className="admin-access-error" role="alert">{listError}</p>}

          {listState !== "error" && listState !== "loading" && applications.length === 0 && (
            <div className="admin-access-empty">
              <span><ShieldCheck size={20} /></span>
              <h3>No applications yet</h3>
              <p>Applications appear here as soon as someone requests admin access.</p>
            </div>
          )}

          {applications.length > 0 && (
            <div className="admin-access-review-list">
              {applications.map((row) => (
                <article className="admin-access-review-row" key={row.id}>
                  <div className="admin-access-review-main">
                    <div className="admin-access-review-top">
                      <strong>{row.applicant_name}</strong>
                      <StatusPill status={row.status} />
                    </div>
                    <span className="admin-access-review-email">{row.email || "No email on record"}</span>
                    <p>{row.reason}</p>
                    <small>
                      Submitted {formatAdminApplicationDate(row.created_at)}
                      {row.status !== "pending" && row.reviewed_at
                        ? ` · ${adminApplicationStatusLabel(row.status)} ${formatAdminApplicationDate(row.reviewed_at)}`
                        : ""}
                    </small>
                    {row.decision_reason && <small className="admin-access-review-decision">Note: {row.decision_reason}</small>}
                  </div>

                  {row.status === "pending" && (
                    <div className="admin-access-review-actions">
                      <button type="button" onClick={() => openReview(row, "approved")}>
                        <Check size={14} /> Approve
                      </button>
                      <button type="button" className="is-danger" onClick={() => openReview(row, "rejected")}>
                        <X size={14} /> Reject
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {reviewTarget && (
            <form className="admin-access-decision" onSubmit={handleReview}>
              <h3>
                {reviewTarget.decision === "approved" ? "Approve" : "Reject"} “{reviewTarget.applicant.applicant_name}”?
              </h3>
              <p>
                {reviewTarget.decision === "approved"
                  ? "Approving records the applicant in admin_accounts and lets them open the admin dashboard."
                  : "Rejecting keeps the applicant out of admin. They may apply again."}
              </p>
              <label htmlFor="admin-decision-reason">Decision note (optional)</label>
              <textarea
                id="admin-decision-reason"
                rows={3}
                maxLength={maximumAdminReasonLength}
                value={reviewReason}
                onChange={(event) => setReviewReason(event.target.value)}
              />
              {reviewError && <p className="admin-access-error" role="alert">{reviewError}</p>}
              <div className="admin-access-actions">
                <button
                  className={`admin-access-button${reviewTarget.decision === "approved" ? "" : " is-danger"}`}
                  type="submit"
                  disabled={reviewState === "submitting"}
                >
                  {reviewState === "submitting"
                    ? "Saving…"
                    : (reviewTarget.decision === "approved" ? "Confirm approval" : "Confirm rejection")}
                </button>
                <button className="admin-access-button is-secondary" type="button" onClick={() => setReviewTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
