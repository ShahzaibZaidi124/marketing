import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  BadgeCheck,
  Briefcase,
  Camera,
  CalendarDays,
  CheckCircle2,
  Globe2,
  LogOut,
  Mail,
  MapPin,
  PencilLine,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ClientProfileCard, ClientProfileDetail, ClientProfileInput } from "../components/ClientProfileCard.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  getClientProfile,
  getClientProfilePictureValidationError,
  removeClientProfilePicture,
  saveClientProfile,
  updateUserMetadata,
  uploadClientProfilePicture,
  verifyAuthenticatedUser,
} from "../lib/auth.js";
import { validateClientProfileDraft } from "../lib/profileValidation.js";

const maxBioLength = 300;

function metadataText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(", ");
  return "";
}

function getAboutFields(metadata = {}) {
  return {
    bio: metadataText(metadata.about !== undefined ? metadata.about : metadata.bio),
    serviceInterests: metadataText(metadata.services_interested !== undefined ? metadata.services_interested : metadata.interests),
    projectInterests: metadataText(metadata.project_interests !== undefined ? metadata.project_interests : metadata.skills_interests),
  };
}

function splitInterestList(value) {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function getMemberSince(createdAt) {
  if (!createdAt) return "Not available";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

export default function ClientProfile() {
  const navigate = useNavigate();
  const {
    user,
    loading,
    error: authError,
    signOut,
    profilePictureUrl,
    profilePictureError,
    refreshProfilePicture,
  } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [profileFields, setProfileFields] = useState({ fullName: "", username: "", country: "", city: "", avatarPath: "" });
  const [profileDraft, setProfileDraft] = useState({ fullName: "", username: "", country: "", city: "", avatarPath: "" });
  const [avatarPreview, setAvatarPreview] = useState("");
  const [selectedAvatarFile, setSelectedAvatarFile] = useState(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const savingProfileRef = useRef(false);
  const uploadingPictureRef = useRef(false);
  const [aboutFields, setAboutFields] = useState({ bio: "", serviceInterests: "", projectInterests: "" });
  const [aboutDraft, setAboutDraft] = useState({ bio: "", serviceInterests: "", projectInterests: "" });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState("");
  const [profileLoadAttempt, setProfileLoadAttempt] = useState(0);
  const userId = user?.id;

  useEffect(() => {
    if (!user || !userId) return undefined;
    let active = true;
    const metadata = user.user_metadata || {};
    const metadataProfileFields = {
      fullName: metadata.full_name || metadata.name || metadata.fullName || "",
      username: metadata.username || "",
      country: metadata.country || "",
      city: metadata.city || "",
      avatarPath: "",
    };
    const metadataAboutFields = getAboutFields(metadata);
    setProfileLoading(true);
    setProfileLoadError("");
    setProfileFields(metadataProfileFields);
    setAboutFields(metadataAboutFields);
    setProfileDraft(metadataProfileFields);
    setAboutDraft(metadataAboutFields);
    setAvatarPreview("");
    setSelectedAvatarFile(null);
    setAvatarRemoved(false);
    setAvatarError("");
    getClientProfile(userId)
      .then(async (profile) => {
        if (!active || !profile) return;
        const nextProfileFields = {
          fullName: profile.full_name || metadataProfileFields.fullName,
          username: profile.username ?? metadataProfileFields.username,
          country: profile.country ?? metadataProfileFields.country,
          city: profile.city ?? metadataProfileFields.city,
          avatarPath: profile.avatar_path || "",
        };
        if (!active) return;
        setProfileFields(nextProfileFields);
        setProfileDraft(nextProfileFields);
        setAboutFields({
          bio: profile.bio ?? metadataAboutFields.bio,
          serviceInterests: profile.services_interested ?? metadataAboutFields.serviceInterests,
          projectInterests: profile.project_interests ?? metadataAboutFields.projectInterests,
        });
        setAboutDraft({
          bio: profile.bio ?? metadataAboutFields.bio,
          serviceInterests: profile.services_interested ?? metadataAboutFields.serviceInterests,
          projectInterests: profile.project_interests ?? metadataAboutFields.projectInterests,
        });
      })
      .catch((error) => {
        if (!active) return;
        setProfileLoadError(error instanceof Error ? error.message : "The profile could not be loaded from Supabase.");
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, profileLoadAttempt]);

  useEffect(() => () => {
    if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  const updateProfileField = (event) => {
    const { name, value } = event.target;
    setProfileDraft((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: "" }));
    setProfileError("");
    setProfileNotice("");
  };

  const updateAboutField = (event) => {
    const { name, value } = event.target;
    setAboutDraft((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: "" }));
    setProfileError("");
    setProfileNotice("");
  };

  const beginEditing = () => {
    setProfileDraft(profileFields);
    setAboutDraft(aboutFields);
    setProfileError("");
    setProfileNotice("");
    setFieldErrors({});
    setAvatarError("");
    setSelectedAvatarFile(null);
    setAvatarRemoved(false);
    setEditMode(true);
  };

  const cancelEditing = () => {
    if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setProfileDraft(profileFields);
    setAboutDraft(aboutFields);
    setAvatarPreview("");
    setSelectedAvatarFile(null);
    setAvatarRemoved(false);
    setAvatarError("");
    setProfileError("");
    setProfileNotice("");
    setFieldErrors({});
    setEditMode(false);
  };

  const updateProfilePicture = (event) => {
    const file = event.target.files?.[0];
    setProfileError("");
    setProfileNotice("");
    setAvatarError("");
    if (!file) return;
    const validationError = getClientProfilePictureValidationError(file);
    if (validationError) {
      if (selectedAvatarFile) {
        if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
        setSelectedAvatarFile(null);
        setAvatarPreview(avatarRemoved ? "" : profilePictureUrl);
      }
      setAvatarError(validationError);
      event.target.value = "";
      return;
    }
    if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(URL.createObjectURL(file));
    setSelectedAvatarFile(file);
    setAvatarRemoved(false);
    event.target.value = "";
  };

  const removeProfilePicture = () => {
    if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview("");
    setSelectedAvatarFile(null);
    setAvatarRemoved(true);
    setProfileDraft((current) => ({ ...current, avatarPath: "" }));
    setAvatarError("");
    setProfileError("");
    setProfileNotice("");
  };

  const uploadSelectedProfilePicture = async () => {
    if (!user || !selectedAvatarFile || uploadingPictureRef.current || savingProfileRef.current) return;
    uploadingPictureRef.current = true;
    setUploadingPicture(true);
    setProfileError("");
    setProfileNotice("");
    setAvatarError("");
    let uploadedAvatarPath = "";
    let profileSaved = false;
    const previousAvatarPath = profileFields.avatarPath;
    try {
      await verifyAuthenticatedUser(user.id);
      uploadedAvatarPath = await uploadClientProfilePicture(user.id, selectedAvatarFile);
      await verifyAuthenticatedUser(user.id);
      const savedProfile = await saveClientProfile({
        userId: user.id,
        email: user.email || "",
        role: user.user_metadata?.role === "seller" ? "seller" : "customer",
        sellerDetails: user.user_metadata?.seller_details || {},
        profile: { avatarPath: uploadedAvatarPath },
      });
      profileSaved = true;
      const savedPath = savedProfile.avatar_path || uploadedAvatarPath;
      setProfileFields((current) => ({ ...current, avatarPath: savedPath }));
      setProfileDraft((current) => ({ ...current, avatarPath: savedPath }));
      const signedUrl = await refreshProfilePicture();
      if (!signedUrl) setAvatarError("Your picture was saved, but its signed image URL could not be loaded.");
      if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview("");
      setSelectedAvatarFile(null);
      setAvatarRemoved(false);
      if (previousAvatarPath && previousAvatarPath !== savedPath) {
        try {
          await removeClientProfilePicture(user.id, previousAvatarPath);
        } catch (error) {
          setAvatarError(`The previous image could not be removed from Storage: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      setProfileNotice("Your profile picture was uploaded successfully.");
    } catch (error) {
      let message = error instanceof Error ? error.message : "The profile picture could not be uploaded.";
      if (uploadedAvatarPath && !profileSaved) {
        try {
          await removeClientProfilePicture(user.id, uploadedAvatarPath);
        } catch (cleanupError) {
          message += ` The newly uploaded image could not be removed: ${cleanupError instanceof Error ? cleanupError.message : "unknown error"}`;
        }
      }
      setProfileError(message);
    } finally {
      uploadingPictureRef.current = false;
      setUploadingPicture(false);
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    if (!user || savingProfileRef.current || uploadingPictureRef.current) return;
    const { values, errors } = validateClientProfileDraft({ ...profileDraft, ...aboutDraft });
    setFieldErrors(errors);
    setProfileError("");
    if (Object.keys(errors).length > 0) {
      const firstInvalidField = ["fullName", "username", "country", "bio"].find((field) => errors[field]);
      document.getElementById(`client-profile-${firstInvalidField}`)?.focus();
      return;
    }

    savingProfileRef.current = true;
    const {
      fullName,
      username,
      country,
      city,
      bio,
      serviceInterests,
      projectInterests,
    } = values;
    setSavingProfile(true);
    setProfileNotice("");
    const role = user.user_metadata?.role === "seller" ? "seller" : "customer";
    const previousAvatarPath = profileFields.avatarPath;
    let uploadedAvatarPath = "";
    try {
      await verifyAuthenticatedUser(user.id);
      if (selectedAvatarFile) {
        uploadedAvatarPath = await uploadClientProfilePicture(user.id, selectedAvatarFile);
      }
      const avatarPath = selectedAvatarFile
        ? uploadedAvatarPath
        : avatarRemoved
          ? null
          : profileFields.avatarPath || null;
      await updateUserMetadata({
        full_name: fullName,
        username,
        country,
        city,
        about: bio,
        services_interested: serviceInterests,
        project_interests: projectInterests,
        role,
      });
      await saveClientProfile({
        userId: user.id,
        email: user.email || "",
        role,
        sellerDetails: user.user_metadata?.seller_details || {},
        profile: {
          fullName,
          username,
          country,
          city,
          bio,
          servicesInterested: serviceInterests,
          projectInterests,
          avatarPath,
        },
      });
      setProfileFields({ fullName, username, country, city, avatarPath: avatarPath || "" });
      setProfileDraft({ fullName, username, country, city, avatarPath: avatarPath || "" });
      setAboutFields({ bio, serviceInterests, projectInterests });
      setAboutDraft({ bio, serviceInterests, projectInterests });
      if (selectedAvatarFile || avatarRemoved) {
        await refreshProfilePicture();
        setAvatarError("");
      }
      if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview("");
      setSelectedAvatarFile(null);
      setAvatarRemoved(false);
      setEditMode(false);
      if (previousAvatarPath && previousAvatarPath !== avatarPath) {
        try {
          await removeClientProfilePicture(user.id, previousAvatarPath);
        } catch (error) {
          setAvatarError(`The previous image could not be removed from Storage: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      setProfileNotice("Your profile information was saved successfully.");
    } catch (error) {
      let message = error instanceof Error ? error.message : "Your profile could not be saved. Please try again.";
      if (uploadedAvatarPath) {
        try {
          await removeClientProfilePicture(user.id, uploadedAvatarPath);
        } catch (cleanupError) {
          message += ` The newly uploaded image could not be removed: ${cleanupError instanceof Error ? cleanupError.message : "unknown error"}`;
        }
      }
      setProfileError(message);
    } finally {
      savingProfileRef.current = false;
      setSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    if (signingOut || !user) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOut();
      navigate("/", { replace: true });
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : "Could not log out. Please try again.");
      setSigningOut(false);
    }
  };

  if (loading) {
    return (
      <main className="client-profile-page">
        <div className="client-profile-state" role="status">Loading your profile…</div>
      </main>
    );
  }

  if (authError || !user) {
    return (
      <main className="client-profile-page">
        <div className="client-profile-state" role={authError ? "alert" : "status"}>
          <span className="client-profile-state-icon"><ShieldCheck size={23} /></span>
          <h1>{authError ? "Profile unavailable" : "Sign in to view your profile"}</h1>
          <p>{authError?.message || "A signed-in NexTech account is required to show client profile information."}</p>
        </div>
      </main>
    );
  }

  if (profileLoading) {
    return (
      <main className="client-profile-page">
        <div className="client-profile-state" role="status">Loading your saved profile from Supabase…</div>
      </main>
    );
  }

  const metadata = user.user_metadata || {};
  const fullName = profileFields.fullName || metadata.full_name || metadata.name || metadata.fullName || "";
  const username = profileFields.username || metadata.username || "";
  const email = user.email || "";
  const country = profileFields.country || metadata.country || "";
  const city = profileFields.city || metadata.city || "";
  const biography = aboutFields.bio;
  const serviceInterests = splitInterestList(aboutFields.serviceInterests);
  const projectInterests = splitInterestList(aboutFields.projectInterests);
  const avatar = avatarRemoved
    ? ""
    : selectedAvatarFile
      ? avatarPreview
      : profilePictureUrl;
  const memberSince = getMemberSince(user.created_at);

  return (
    <main className="client-profile-page">
      <div className="client-profile-container">
        <div className="client-profile-intro">
          <span className="client-profile-eyebrow"><Sparkles size={14} /> YOUR NEXTECH ACCOUNT</span>
          <h1>Client profile</h1>
          <p>Your profile and account details, all in one place.</p>
        </div>
        {profileLoadError && (
          <div className="client-profile-load-error" role="alert">
            <p>Your profile could not be loaded from Supabase. {profileLoadError}</p>
            <button type="button" onClick={() => setProfileLoadAttempt((attempt) => attempt + 1)}>Retry</button>
          </div>
        )}
        {(avatarError || profilePictureError) && !editMode && <p className="client-profile-action-error" role="alert">{avatarError || profilePictureError}</p>}

        <section className="client-profile-hero" aria-label="Profile header">
          <div className="client-profile-hero-glow" aria-hidden="true" />
          <div className="client-profile-avatar">
            {avatar
              ? <img src={avatar} alt={fullName ? `${fullName} profile` : "Profile"} />
              : <UserRound size={35} aria-hidden="true" />}
          </div>
          <div className="client-profile-hero-copy">
            <div className="client-profile-badges">
              <span className="client-profile-client-badge"><BadgeCheck size={15} /> Client</span>
              <span className="client-profile-member-badge"><CalendarDays size={14} /> Member since {memberSince}</span>
            </div>
            <h2>{fullName || "Name not provided"}</h2>
            <p className="client-profile-username">{username ? `@${username}` : "Username not provided"}</p>
          </div>
          <span className="client-profile-hero-decoration" aria-hidden="true"><Sparkles size={22} /></span>
        </section>

        <form className="client-profile-page-form" onSubmit={saveProfile} noValidate>
        <div className="client-profile-grid">
          <ClientProfileCard
            icon={UserRound}
            title="Personal information"
            description="Your basic contact and location details."
            className="client-profile-personal"
          >
            {editMode
              ? (
                <div className="client-profile-edit-form">
                  <div className="client-profile-picture-row">
                    <div className="client-profile-avatar client-profile-edit-avatar">
                      {avatar
                        ? <img src={avatar} alt={fullName ? `${fullName} profile` : "Profile preview"} />
                        : <UserRound size={28} aria-hidden="true" />}
                    </div>
                    <div className="client-profile-picture-copy">
                      <strong>Profile picture</strong>
                      <span>JPG, PNG, or WebP · Up to 2 MB</span>
                      <label className="client-profile-picture-upload">
                        <Camera size={14} /> {profileDraft.avatarPath ? "Choose Replacement" : "Choose Picture"}
                        <input
                          id="client-profile-picture"
                          className="client-profile-picture-input"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={updateProfilePicture}
                          disabled={uploadingPicture || savingProfile}
                        />
                      </label>
                      {selectedAvatarFile && (
                        <button
                          className="client-profile-upload-action"
                          type="button"
                          onClick={uploadSelectedProfilePicture}
                          disabled={uploadingPicture || savingProfile}
                        >
                          <Upload size={14} />
                          {uploadingPicture ? "Uploading…" : profileFields.avatarPath ? "Replace Picture" : "Upload Picture"}
                        </button>
                      )}
                      {(avatar || profileDraft.avatarPath || selectedAvatarFile) && (
                        <button className="client-profile-picture-remove" type="button" onClick={removeProfilePicture} disabled={uploadingPicture || savingProfile}>
                          <Trash2 size={14} /> Remove Picture
                        </button>
                      )}
                    </div>
                  </div>
                  {(avatarError || profilePictureError) && <p className="client-profile-action-error" role="alert">{avatarError || profilePictureError}</p>}
                  <div className="client-profile-form-grid">
                    <ClientProfileInput
                      id="client-profile-full-name"
                      label="Full name"
                      name="fullName"
                      value={profileDraft.fullName}
                      onChange={updateProfileField}
                      autoComplete="name"
                      required
                      minLength={2}
                      error={fieldErrors.fullName}
                    />
                    <ClientProfileInput
                      id="client-profile-username"
                      label="Username"
                      name="username"
                      value={profileDraft.username}
                      onChange={updateProfileField}
                      autoComplete="username"
                      required
                      minLength={3}
                      maxLength={20}
                      pattern="[A-Za-z0-9_]{3,20}"
                      error={fieldErrors.username}
                      aria-describedby="client-profile-username-help"
                    />
                    <ClientProfileInput
                      id="client-profile-email"
                      label="Email address"
                      type="email"
                      value={email}
                      readOnly
                      aria-readonly="true"
                      autoComplete="email"
                    />
                    <ClientProfileInput
                      id="client-profile-country"
                      label="Country"
                      name="country"
                      value={profileDraft.country}
                      onChange={updateProfileField}
                      autoComplete="country-name"
                      required
                      error={fieldErrors.country}
                    />
                    <ClientProfileInput
                      id="client-profile-city"
                      label="City"
                      name="city"
                      value={profileDraft.city}
                      onChange={updateProfileField}
                      autoComplete="address-level2"
                    />
                  </div>
                  <span id="client-profile-username-help" className="client-profile-field-help">Use 3–20 letters, numbers, or underscores.</span>
                </div>
              )
              : (
                <>
                  <div className="client-profile-details-grid">
                    <ClientProfileDetail icon={UserRound} label="Full name" value={fullName} />
                    <ClientProfileDetail icon={AtSign} label="Username" value={username ? `@${username}` : ""} />
                    <ClientProfileDetail icon={Mail} label="Email address" value={email} />
                    <ClientProfileDetail icon={Globe2} label="Country" value={country} />
                    <ClientProfileDetail icon={MapPin} label="City" value={city} />
                  </div>
                </>
              )}
          </ClientProfileCard>

          <ClientProfileCard
            icon={Briefcase}
            title="About me"
            description="A little about you and what you’re looking for."
            className="client-profile-about"
          >
            {editMode
              ? (
                <div className="client-profile-about-form">
                  <label className="client-profile-form-field client-profile-about-field" htmlFor="client-profile-bio">
                    <span>Short bio</span>
                    <textarea
                      id="client-profile-bio"
                      name="bio"
                      rows="4"
                      maxLength={maxBioLength}
                      value={aboutDraft.bio}
                      onChange={updateAboutField}
                      aria-invalid={Boolean(fieldErrors.bio)}
                      aria-describedby={`client-profile-bio-count${fieldErrors.bio ? " client-profile-bio-error" : ""}`}
                      placeholder="Tell sellers a little about yourself."
                    />
                    {fieldErrors.bio && <span className="client-profile-field-error" id="client-profile-bio-error" role="alert">{fieldErrors.bio}</span>}
                  </label>
                  <span id="client-profile-bio-count" className={`client-profile-bio-count${aboutDraft.bio.length > maxBioLength ? " over-limit" : ""}`}>
                    {aboutDraft.bio.length}/{maxBioLength} characters
                  </span>
                  <label className="client-profile-form-field client-profile-about-field" htmlFor="client-profile-services">
                    <span>Service interests</span>
                    <textarea
                      id="client-profile-services"
                      name="serviceInterests"
                      rows="2"
                      value={aboutDraft.serviceInterests}
                      onChange={updateAboutField}
                      placeholder="For example: Web Development, Graphic Design, Video Editing"
                    />
                  </label>
                  <label className="client-profile-form-field client-profile-about-field" htmlFor="client-profile-project-interests">
                    <span>Skills or project interests</span>
                    <textarea
                      id="client-profile-project-interests"
                      name="projectInterests"
                      rows="2"
                      value={aboutDraft.projectInterests}
                      onChange={updateAboutField}
                      placeholder="Add skills or kinds of projects you’re interested in."
                    />
                  </label>
                </div>
              )
              : (
                <>
                  <div className="client-profile-about-block">
                    <h3>Short bio</h3>
                    <p>{biography || "No biography added yet."}</p>
                  </div>
                  <div className="client-profile-about-block client-profile-interests">
                    <h3><Sparkles size={14} /> Service interests</h3>
                    {serviceInterests.length
                      ? <div className="client-profile-interest-tags">{serviceInterests.map((interest, index) => <span key={`${interest}-${index}`}>{interest}</span>)}</div>
                      : <p>No service interests added yet.</p>}
                  </div>
                  <div className="client-profile-about-block client-profile-interests">
                    <h3><Sparkles size={14} /> Skills or project interests</h3>
                    {projectInterests.length
                      ? <div className="client-profile-interest-tags">{projectInterests.map((interest, index) => <span key={`${interest}-${index}`}>{interest}</span>)}</div>
                      : <p>No skills or project interests added yet.</p>}
                  </div>
                </>
              )}
          </ClientProfileCard>
        </div>
        {editMode && (
          <>
            {profileError && <p className="client-profile-action-error" role="alert">{profileError}</p>}
            {profileNotice && <p className="client-profile-save-success" role="status"><CheckCircle2 size={16} /> {profileNotice}</p>}
            <div className="client-profile-form-actions">
              <button className="client-profile-cancel-button" type="button" onClick={cancelEditing} disabled={savingProfile || uploadingPicture}>
                <X size={15} /> Cancel
              </button>
              <button className="client-profile-save-button" type="submit" disabled={savingProfile || uploadingPicture}>
                <Save size={15} /> {savingProfile ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </>
        )}
        </form>
        {!editMode && profileNotice && <p className="client-profile-save-success" role="status"><CheckCircle2 size={16} /> {profileNotice}</p>}

        <ClientProfileCard
          icon={ShieldCheck}
          title="Account settings"
          description="Manage your profile and account access."
          className="client-profile-settings"
        >
          <div className="client-profile-settings-row">
            <div className="client-profile-account-type">
              <span className="client-profile-settings-icon"><BadgeCheck size={18} /></span>
              <span><small>Account type</small><strong>Client</strong></span>
            </div>
            <div className="client-profile-settings-actions">
              {!editMode && (
                <button className="client-profile-edit-button" type="button" onClick={beginEditing}>
                  <PencilLine size={16} /> Edit Profile
                </button>
              )}
              <button className="client-profile-logout-button" type="button" onClick={handleLogout} disabled={signingOut}>
                <LogOut size={16} /> {signingOut ? "Logging out…" : "Log Out"}
              </button>
            </div>
          </div>
          {signOutError && <p className="client-profile-action-error" role="alert">{signOutError}</p>}
        </ClientProfileCard>
      </div>
    </main>
  );
}
