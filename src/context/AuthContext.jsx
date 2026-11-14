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
    let subscription;

    try {
      const { data } = getSupabaseClient().auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        setLoading(false);
        setError(null);
      });
      subscription = data.subscription;
    } catch (authError) {
      setError(authError instanceof Error ? authError : new Error("Supabase authentication could not be initialized."));
      setLoading(false);
    }

    return () => subscription?.unsubscribe();
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
