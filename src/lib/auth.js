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

export async function updateUserEmail(email) {
  const { data, error } = await getSupabaseClient().auth.updateUser({ email: email.trim() });

  if (error) throw error;
  return data.user;
}

export async function updateUserPassword(password) {
  const { error } = await getSupabaseClient().auth.updateUser({ password });

  if (error) throw error;
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

const profilePictureBucket = "profile-pictures";
const maxProfilePictureSize = 2 * 1024 * 1024;
const profilePictureExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const clientProfileColumns = "id, email, full_name, username, role, country, city, bio, services_interested, project_interests, avatar_path";

export function getClientProfilePictureValidationError(file) {
  if (!file || typeof file.type !== "string" || !Number.isFinite(file.size) || file.size < 0) {
    return "Choose a profile picture to upload.";
  }
  if (!profilePictureExtensions[file.type]) {
    return "Choose a JPG, PNG, or WebP profile picture.";
  }
  if (file.size > maxProfilePictureSize) {
    return "Profile pictures must be 2 MB or smaller.";
  }
  return "";
}

export async function verifyAuthenticatedUser(userId) {
  if (!userId) throw new Error("A signed-in user is required.");
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Please sign in again before changing your profile.");
  if (data.user.id !== userId) throw new Error("You can only change your own profile.");
  return data.user;
}

function assertOwnedProfilePicturePath(userId, path) {
  const parts = typeof path === "string" ? path.split("/") : [];
  if (parts.length !== 2 || parts[0] !== userId || !parts[1]) {
    throw new Error("The profile picture does not belong to the signed-in user.");
  }
}

async function verifyOwnedProfilePicturePath(userId, path) {
  await verifyAuthenticatedUser(userId);
  assertOwnedProfilePicturePath(userId, path);
}

export async function uploadClientProfilePicture(userId, file) {
  const validationError = getClientProfilePictureValidationError(file);
  if (validationError) throw new Error(validationError);
  if (typeof File === "undefined" || !(file instanceof File)) {
    throw new Error("Choose a valid image file to upload.");
  }
  await verifyAuthenticatedUser(userId);
  const extension = profilePictureExtensions[file.type];

  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await getSupabaseClient()
    .storage
    .from(profilePictureBucket)
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

  if (error) throw error;
  return path;
}

export async function getClientProfilePictureUrl(userId, path) {
  await verifyOwnedProfilePicturePath(userId, path);
  const { data, error } = await getSupabaseClient()
    .storage
    .from(profilePictureBucket)
    .createSignedUrl(path, 60 * 60);

  if (error) throw error;
  return data.signedUrl;
}

export async function removeClientProfilePicture(userId, path) {
  await verifyOwnedProfilePicturePath(userId, path);
  const { error } = await getSupabaseClient()
    .storage
    .from(profilePictureBucket)
    .remove([path]);

  if (error) throw error;
}

export async function getClientProfile(userId) {
  if (!userId) throw new Error("A signed-in user is required to load a client profile.");
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select(clientProfileColumns)
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function saveClientProfile({ userId, email, role, sellerDetails, profile }) {
  if (!userId) throw new Error("A signed-in user is required to save a client profile.");
  if (!profile || typeof profile !== "object") throw new Error("Client profile data is required.");
  await verifyAuthenticatedUser(userId);
  if (profile.avatarPath) assertOwnedProfilePicturePath(userId, profile.avatarPath);

  const profileFields = { updated_at: new Date().toISOString() };
  if (Object.prototype.hasOwnProperty.call(profile, "fullName")) profileFields.full_name = profile.fullName;
  if (Object.prototype.hasOwnProperty.call(profile, "username")) profileFields.username = profile.username || null;
  if (Object.prototype.hasOwnProperty.call(profile, "country")) profileFields.country = profile.country;
  if (Object.prototype.hasOwnProperty.call(profile, "city")) profileFields.city = profile.city;
  if (Object.prototype.hasOwnProperty.call(profile, "bio")) profileFields.bio = profile.bio;
  if (Object.prototype.hasOwnProperty.call(profile, "servicesInterested")) profileFields.services_interested = profile.servicesInterested;
  if (Object.prototype.hasOwnProperty.call(profile, "projectInterests")) profileFields.project_interests = profile.projectInterests;
  if (Object.prototype.hasOwnProperty.call(profile, "avatarPath")) profileFields.avatar_path = profile.avatarPath;

  const supabase = getSupabaseClient();
  const { data: existingProfile, error: lookupError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  const result = existingProfile
    ? await supabase
      .from("profiles")
      .update(profileFields)
      .eq("id", userId)
      .select(clientProfileColumns)
      .maybeSingle()
    : await supabase
      .from("profiles")
      .insert({
        id: userId,
        email: email || null,
        role: role || "customer",
        seller_details: sellerDetails && typeof sellerDetails === "object" ? sellerDetails : {},
        ...profileFields,
      })
      .select(clientProfileColumns)
      .single();

  if (result.error) throw result.error;
  if (!result.data) throw new Error("The client profile was not updated. Confirm that your account has access to its own profile.");
  return result.data;
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
