import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabaseClient } from "../lib/supabase.js";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [callbackParams] = useState(() => {
    const callbackUrl = new URL(window.location.href);
    const hashParams = new URLSearchParams(callbackUrl.hash.slice(1));
    return {
      code: callbackUrl.searchParams.get("code"),
      error: callbackUrl.searchParams.get("error_description")
        || callbackUrl.searchParams.get("error")
        || hashParams.get("error_description")
        || hashParams.get("error"),
    };
  });
  const completion = useRef(null);

  useEffect(() => {
    let active = true;

    if (!completion.current) {
      completion.current = (async () => {
        if (callbackParams.error) throw new Error(callbackParams.error);

        const supabase = getSupabaseClient();
        if (callbackParams.code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(callbackParams.code);
          if (error) throw error;
          if (!data.session) throw new Error("Supabase exchanged the authorization code without returning a session.");
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          throw new Error("Google sign-in returned no authorization code or active session. Please try again.");
        }

        return data.session;
      })();
    }

    completion.current.then(() => {
      if (active) navigate("/", { replace: true });
    }).catch((authError) => {
      if (!active) return;
      const message = authError instanceof Error
        ? authError.message
        : "Google sign-in could not be completed. Please try again.";
      navigate("/seller/login", { replace: true, state: { authError: message } });
    });

    return () => {
      active = false;
    };
  }, [callbackParams, navigate]);

  return (
    <main className="market-section seller-page seller-login-page">
      <div className="seller-login-card" role="status" aria-live="polite">
        <span className="market-eyebrow">GOOGLE SIGN-IN</span>
        <h1>Completing sign-in…</h1>
        <p>Verifying your TechStudio session with Supabase.</p>
      </div>
    </main>
  );
}
