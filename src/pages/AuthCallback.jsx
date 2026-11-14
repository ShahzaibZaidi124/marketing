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
      returnTo: callbackUrl.searchParams.get("next") === "/seller/profile" ? "/seller/profile" : "/",
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
        if (!data.session) throw new Error("Authentication returned no authorization code or active session. Please try again.");

        return data.session;
      })();
    }

    completion.current.then((session) => {
      if (!active) return;
      const metadata = session.user.user_metadata || {};
      const sellerDetails = metadata.seller_details || {};
      const sellerDraft = {
        fullName: metadata.full_name || "",
        username: metadata.username || "",
        email: session.user.email || "",
        about: sellerDetails.about || "",
        skills: Array.isArray(sellerDetails.skills) ? sellerDetails.skills : [],
        experience: sellerDetails.experience || "",
        portfolioUrl: sellerDetails.portfolioUrl || "",
      };
      navigate(callbackParams.returnTo, {
        replace: true,
        state: callbackParams.returnTo === "/seller/profile" ? { sellerDraft } : undefined,
      });
    }).catch((authError) => {
      if (!active) return;
      const message = authError instanceof Error
        ? authError.message
        : "Sign-in could not be completed. Please try again.";
      navigate("/seller/login", { replace: true, state: { authError: message } });
    });

    return () => {
      active = false;
    };
  }, [callbackParams, navigate]);

  return (
    <main className="market-section seller-page seller-login-page">
      <div className="seller-login-card" role="status" aria-live="polite">
        <span className="market-eyebrow">ACCOUNT SIGN-IN</span>
        <h1>Completing sign-in…</h1>
        <p>Verifying your NexTech session with Supabase.</p>
      </div>
    </main>
  );
}
