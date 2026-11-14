import { getSupabaseClient } from "./supabase.js";

export async function signInWithGoogle() {
  const { error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: "google",
    options: {
      queryParams: {
        prompt: "select_account",
      },
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) throw error;
}

export async function signInWithEmail({ email, password }) {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) throw error;
  return data;
}

export async function signUpWithEmail({ email, password, fullName, username, sellerDetails }) {
  const { data, error } = await getSupabaseClient().auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        full_name: fullName,
        role: "seller",
        username: username.toLowerCase(),
        seller_details: sellerDetails,
      },
      emailRedirectTo: `${window.location.origin}/auth/callback?next=/seller/profile`,
    },
  });

  if (error) throw error;
  return data;
}

export async function updateUserMetadata(metadata) {
  const { data, error } = await getSupabaseClient().auth.updateUser({ data: metadata });

  if (error) throw error;
  return data.user;
}

export async function saveUserProfile({ userId, email, fullName, username, role, sellerDetails }) {
  const { error } = await getSupabaseClient().from("profiles").upsert({
    id: userId,
    email,
    full_name: fullName,
    username: username ? username.toLowerCase() : null,
    role,
    seller_details: sellerDetails,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  if (error) throw error;
}

export async function getUserProfile(userId) {
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("id, email, full_name, username, role, seller_details")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
