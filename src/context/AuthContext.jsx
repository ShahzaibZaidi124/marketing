import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getSupabaseClient } from "../lib/supabase.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const signOut = useCallback(async () => {
    const { error: signOutError } = await getSupabaseClient().auth.signOut();
    if (signOutError) throw signOutError;
  }, []);

  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;
    let subscription;

    try {
      const supabase = getSupabaseClient();
      const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        receivedAuthEvent = true;
        if (!active) return;
        setSession(nextSession);
        setLoading(false);
        setError(null);
      });
      subscription = data.subscription;

      supabase.auth.getSession()
        .then(({ data: sessionData, error: sessionError }) => {
          if (sessionError) throw sessionError;
          if (!active || receivedAuthEvent) return;
          setSession(sessionData.session);
          setLoading(false);
          setError(null);
        })
        .catch((authError) => {
          if (!active || receivedAuthEvent) return;
          setError(authError instanceof Error
            ? authError
            : new Error("Supabase authentication could not be restored."));
          setLoading(false);
        });
    } catch (authError) {
      setError(authError instanceof Error ? authError : new Error("Supabase authentication could not be initialized."));
      setLoading(false);
    }

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, error, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider.");
  return context;
}
