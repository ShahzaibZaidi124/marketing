import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, LogIn, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import GoogleOAuthButton from "./GoogleOAuthButton.jsx";
import { isOwnerAccount } from "../lib/messages.js";
import { hasAdminAccess } from "../lib/adminAccess.js";

function GuardState({ icon: Icon, title, children, tone = "" }) {
  return (
    <section className={`route-guard${tone ? ` ${tone}` : ""}`} aria-live="polite">
      <div>
        <span className="route-guard-icon"><Icon size={22} aria-hidden="true" /></span>
        <h1>{title}</h1>
        {children}
      </div>
    </section>
  );
}

function GuardLoading({ label }) {
  return (
    <section className="route-guard" aria-live="polite">
      <div>
        <span className="route-guard-icon"><Loader2 className="messages-spinner" size={22} aria-hidden="true" /></span>
        <h1>{label}</h1>
      </div>
    </section>
  );
}

// Route-level gate for pages that only make sense for a signed-in account. The
// database still enforces access through RLS; this only avoids an empty page.
export function RequireAuth({ children }) {
  const { user, loading } = useAuth();

  if (loading) return <GuardLoading label="Checking your session…" />;

  if (!user) {
    return (
      <GuardState icon={LogIn} title="Sign in to use messages">
        <p>Messages are private to your NexTech account. Sign in with Google to start a conversation with the NexTech team.</p>
        <GoogleOAuthButton />
        <Link className="route-guard-link" to="/services">Browse services instead</Link>
      </GuardState>
    );
  }

  return children;
}

// Owner gate for the admin inbox. public.is_owner() is the existing server-side
// check; it fails closed here and the Edge Functions re-check ownership on every
// write, so a forged front-end flag never grants access to real conversations.
export function RequireOwner({ children }) {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState("checking");
  const [errorMessage, setErrorMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loading) return undefined;
    if (!user) {
      setStatus("signed-out");
      return undefined;
    }

    let active = true;
    setStatus("checking");
    setErrorMessage("");

    isOwnerAccount()
      .then((isOwner) => {
        if (!active) return;
        setStatus(isOwner ? "owner" : "denied");
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : "The owner check could not be completed.");
        setStatus("error");
      });

    return () => { active = false; };
  }, [user, loading, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  if (loading || (user && status === "checking")) {
    return <GuardLoading label="Verifying owner access…" />;
  }

  if (!user || status === "signed-out") {
    return (
      <GuardState icon={LogIn} title="Owner sign-in required">
        <p>This inbox is limited to the NexTech owner. Sign in with the owner account to continue.</p>
        <GoogleOAuthButton />
      </GuardState>
    );
  }

  if (status === "error") {
    return (
      <GuardState icon={ShieldAlert} title="Owner check unavailable" tone="is-error">
        <p>{errorMessage} Owner access could not be confirmed, so the inbox stays closed.</p>
        <button className="route-guard-button" type="button" onClick={retry}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
      </GuardState>
    );
  }

  if (status === "denied") {
    return (
      <GuardState icon={ShieldAlert} title="Owner access required" tone="is-denied">
        <p>This account is not the NexTech owner, so the customer inbox is not available. Customer messaging stays at <Link className="route-guard-link" to="/messages">Messages</Link>.</p>
      </GuardState>
    );
  }

  return children;
}

// Admin gate for the dashboard. public.has_admin_access() is the existing
// server-side check: it is true for the owner and for accounts approved in
// admin_accounts, and false otherwise. It fails closed here, and every write
// re-checks server-side, so manually entering an /admin URL never grants access.
export function RequireAdminAccess({ children }) {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState("checking");
  const [errorMessage, setErrorMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loading) return undefined;
    if (!user) {
      setStatus("signed-out");
      return undefined;
    }

    let active = true;
    setStatus("checking");
    setErrorMessage("");

    hasAdminAccess()
      .then((granted) => {
        if (!active) return;
        setStatus(granted ? "granted" : "denied");
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : "The admin check could not be completed.");
        setStatus("error");
      });

    return () => { active = false; };
  }, [user, loading, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  if (loading || (user && status === "checking")) {
    return <GuardLoading label="Verifying admin access…" />;
  }

  if (!user || status === "signed-out") {
    return (
      <GuardState icon={LogIn} title="Admin sign-in required">
        <p>The admin dashboard is limited to the NexTech owner and approved admins. Sign in to continue, or <Link className="route-guard-link" to="/admin-access">apply for admin access</Link>.</p>
        <GoogleOAuthButton />
      </GuardState>
    );
  }

  if (status === "error") {
    return (
      <GuardState icon={ShieldAlert} title="Admin check unavailable" tone="is-error">
        <p>{errorMessage} Admin access could not be confirmed, so the dashboard stays closed.</p>
        <button className="route-guard-button" type="button" onClick={retry}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
      </GuardState>
    );
  }

  if (status === "denied") {
    return (
      <GuardState icon={ShieldAlert} title="Admin access required" tone="is-denied">
        <p>This account is not the NexTech owner and has not been approved for admin access, so the dashboard is not available. You can <Link className="route-guard-link" to="/admin-access">apply for admin access</Link>, or return to <Link className="route-guard-link" to="/">the marketplace</Link>.</p>
      </GuardState>
    );
  }

  return children;
}
