import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "../lib/supabase.js";
import { getClientProfile, getClientProfilePictureUrl } from "../lib/auth.js";

const AuthContext = createContext(null);
const profilePictureRefreshInterval = 55 * 60 * 1000;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profilePictureUrl, setProfilePictureUrl] = useState("");
  const [profilePictureLoading, setProfilePictureLoading] = useState(false);
  const [profilePictureError, setProfilePictureError] = useState("");
  const profilePictureRequest = useRef(0);
  const signOut = useCallback(async () => {
    const { error: signOutError } = await getSupabaseClient().auth.signOut();
    if (signOutError) throw signOutError;
  }, []);
  const refreshProfilePicture = useCallback(async () => {
    const requestId = ++profilePictureRequest.current;
    const currentUser = session?.user;
    if (!currentUser) {
      setProfilePictureUrl("");
      setProfilePictureError("");
      setProfilePictureLoading(false);
      return "";
    }

    setProfilePictureLoading(true);
    setProfilePictureError("");
    try {
      const profile = await getClientProfile(currentUser.id);
      const nextUrl = profile?.avatar_path
        ? await getClientProfilePictureUrl(currentUser.id, profile.avatar_path)
        : currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || "";
      if (requestId === profilePictureRequest.current) setProfilePictureUrl(nextUrl);
      return nextUrl;
    } catch (pictureError) {
      if (requestId === profilePictureRequest.current) {
        setProfilePictureUrl("");
        setProfilePictureError(pictureError instanceof Error
          ? pictureError.message
          : "The profile picture could not be loaded.");
      }
      return "";
    } finally {
      if (requestId === profilePictureRequest.current) setProfilePictureLoading(false);
    }
  }, [session?.user]);

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

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      profilePictureRequest.current += 1;
      setProfilePictureUrl("");
      setProfilePictureError("");
      setProfilePictureLoading(false);
      return undefined;
    }

    void refreshProfilePicture();
    const timer = window.setInterval(() => {
      void refreshProfilePicture();
    }, profilePictureRefreshInterval);
    return () => {
      window.clearInterval(timer);
    };
  }, [session?.user?.id, refreshProfilePicture]);

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      loading,
      error,
      signOut,
      profilePictureUrl,
      profilePictureLoading,
      profilePictureError,
      refreshProfilePicture,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider.");
  return context;
}
