import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getSupabaseClient } from "../lib/supabase.js";

function GoogleLogo() {
  return (
    <svg className="google-oauth-logo" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.7-.4-4H24v7.6h11a9.5 9.5 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.8Z" />
      <path fill="#34A853" d="M24 44c5.4 0 10-1.8 13.4-4.8l-6.5-5a12 12 0 0 1-17.8-6.3H6.4v5.2A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M13.1 27.9a12 12 0 0 1 0-7.8v-5.2H6.4a20 20 0 0 0 0 18.2l6.7-5.2Z" />
      <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6 29.4 4 24 4A20 20 0 0 0 6.4 14.9l6.7 5.2A12 12 0 0 1 24 12Z" />
    </svg>
  );
}

export default function GoogleOAuthButton({ initialError = "" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);

  const startGoogleSignIn = async () => {
    if (loading) return;
    setLoading(true);
    setError("");

    try {
      const { error: authError } = await getSupabaseClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (authError) throw authError;
    } catch (authError) {
      setError(authError instanceof Error
        ? authError.message
        : "Google sign-in could not be started. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="google-oauth-section">
      <button
        className="google-oauth-button"
        type="button"
        onClick={startGoogleSignIn}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? <Loader2 className="google-oauth-spinner" size={18} aria-hidden="true" /> : <GoogleLogo />}
        <span>{loading ? "Connecting to Google…" : "Continue with Google"}</span>
      </button>
      {error && <p className="google-oauth-error" role="alert">{error}</p>}
    </div>
  );
}
