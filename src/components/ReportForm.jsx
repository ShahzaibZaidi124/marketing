import { useRef, useState } from "react";
import {
  formatReportTargetType,
  getReportErrorMessage,
  maximumReportReasonLength,
  reportCategoryOptions,
  submitReport,
  validateReportDraft,
} from "../lib/reports.js";

// A shared, self-contained report form used by both the service page and the
// customer order page. It sends only target_type, target_id, category and
// reason: reporter identity, the target label, the pending status and every
// resolution field are derived on the server by the reports trigger and the RLS
// policies, so nothing here can forge them. A duplicate open report for the same
// target comes back as a unique-violation and is explained rather than retried.
export default function ReportForm({ targetType, targetId, onSubmitted, onCancel }) {
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  const targetNoun = formatReportTargetType(targetType);

  const submit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");
    const { category: safeCategory, reason: safeReason, error: validationError } =
      validateReportDraft({ targetType, targetId, category, reason });
    if (validationError) {
      setError(validationError);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const report = await submitReport({ targetType, targetId, category: safeCategory, reason: safeReason });
      onSubmitted(report);
    } catch (submitError) {
      setError(getReportErrorMessage(submitError));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form className="report-form" onSubmit={submit} noValidate>
      <p className="report-form-note">
        Reports are private to you and the NexTech team. Your account is recorded automatically, so do not include personal details.
      </p>
      <label>
        Category
        <select
          value={category}
          onChange={(event) => { setCategory(event.target.value); setError(""); }}
          disabled={submitting}
          required
        >
          <option value="">Choose a category</option>
          {reportCategoryOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        Explanation <span className="report-form-counter">Optional · {Array.from(reason).length}/{maximumReportReasonLength}</span>
        <textarea
          rows="4"
          maxLength={maximumReportReasonLength}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={`Explain why you are reporting this ${targetNoun}.`}
          disabled={submitting}
        />
      </label>
      {error && <p className="dashboard-form-error" role="alert">{error}</p>}
      <div className="report-form-actions">
        <button className="market-button market-button-primary" type="submit" disabled={submitting || !category}>
          {submitting ? "Submitting…" : "Submit report"}
        </button>
        <button className="report-form-cancel" type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </form>
  );
}
