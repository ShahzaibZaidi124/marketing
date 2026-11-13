import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Code2,
  Eye,
  EyeOff,
  FileImage,
  Globe2,
  Languages,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useMarketplace } from "../context/MarketplaceContext.jsx";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const allowedPortfolioExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
const maxAvatarSize = 5 * 1024 * 1024;
const maxPortfolioSize = 10 * 1024 * 1024;

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function DemoNotice({ children }) {
  return (
    <div className="seller-demo-notice" role="note">
      <ShieldAlert size={17} />
      <p>{children}</p>
    </div>
  );
}

function ErrorMessage({ id, children }) {
  return children ? <span className="seller-field-error" id={id} role="alert">{children}</span> : null;
}

function SellerPageHeading({ eyebrow, title, description }) {
  return (
    <header className="seller-page-heading">
      <span className="market-eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  );
}

export function SellerIntro() {
  const benefits = [
    { Icon: Code2, title: "Showcase Your Skills", description: "Tell customers what you do best and the technologies you work with." },
    { Icon: Sparkles, title: "Build Your Portfolio", description: "Bring your experience and website projects together in one profile." },
    { Icon: MessageCircle, title: "Connect With Customers", description: "Help people with great ideas find a developer who fits their needs." },
  ];

  return (
    <main className="market-section seller-page seller-intro-page">
      <Link className="seller-back-link" to="/"><ArrowLeft size={14} /> Back to marketplace</Link>
      <section className="seller-intro-hero">
        <div className="seller-intro-glow seller-intro-glow-blue" />
        <div className="seller-intro-glow seller-intro-glow-purple" />
        <div className="seller-intro-copy">
          <span className="market-eyebrow"><span className="market-eyebrow-dot" /> FOR WEBSITE DEVELOPERS</span>
          <h1>Become a Seller on <span>TechStudio</span></h1>
          <p>Share your website development skills, showcase your work and connect with customers.</p>
          <Link className="market-button market-button-primary seller-primary-cta" to="/seller/register">Start Selling <ArrowRight size={16} /></Link>
          <span className="seller-intro-login">Already have an account? <Link to="/seller/login">Log in</Link></span>
        </div>
        <div className="seller-intro-art" aria-hidden="true">
          <span className="seller-intro-art-orbit seller-intro-art-orbit-one" />
          <span className="seller-intro-art-orbit seller-intro-art-orbit-two" />
          <span className="seller-intro-art-card seller-intro-art-card-back"><Code2 size={20} /><span>Build something great</span></span>
          <span className="seller-intro-art-card seller-intro-art-card-front"><span className="seller-intro-art-avatar"><UserRound size={23} /></span><span><strong>Your next chapter</strong><small>Share your talent with TechStudio</small></span><ArrowUpRight size={18} /></span>
          <span className="seller-intro-art-spark seller-intro-art-spark-one" />
          <span className="seller-intro-art-spark seller-intro-art-spark-two" />
        </div>
      </section>

      <section className="seller-benefits-section">
        <div className="seller-benefits-heading">
          <span className="market-eyebrow">A place for your next opportunity</span>
          <h2>Make your skills easier to find.</h2>
        </div>
        <div className="seller-benefit-grid">
          {benefits.map(({ Icon, title, description }, index) => (
            <article className="seller-benefit-card" key={title}>
              <span className={`seller-benefit-icon seller-benefit-icon-${index + 1}`}><Icon size={20} /></span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
        <div className="seller-intro-bottom-cta">
          <div><h2>Ready to share what you build?</h2><p>Create a profile preview and see how your seller workspace will look.</p></div>
          <Link className="market-button market-button-primary" to="/seller/register">Start Selling <ArrowRight size={15} /></Link>
        </div>
        <DemoNotice>Seller registration is currently a demo. No account is created, and profile information is not sent to or saved on a server.</DemoNotice>
      </section>
    </main>
  );
}

export function SellerRegistration() {
  const location = useLocation();
  const navigate = useNavigate();
  const existingDraft = location.state?.sellerDraft;
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(existingDraft?.avatar || "");

  const clearError = (event) => {
    const { name } = event.target;
    if (name) setErrors((current) => ({ ...current, [name]: "" }));
  };

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0];
    setErrors((current) => ({ ...current, avatar: "" }));
    if (!file) return;
    if (!imageTypes.includes(file.type)) {
      setErrors((current) => ({ ...current, avatar: "Choose a JPG, PNG or WebP image." }));
      event.target.value = "";
      return;
    }
    if (file.size > maxAvatarSize) {
      setErrors((current) => ({ ...current, avatar: "Profile images must be 5 MB or smaller." }));
      event.target.value = "";
      return;
    }
    if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const submitRegistration = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = form.elements;
    const password = values.namedItem("password").value;
    const confirmPassword = values.namedItem("confirmPassword").value;
    const nextErrors = {};
    const fullName = values.namedItem("fullName").value.trim();
    const username = values.namedItem("username").value.trim();
    const email = values.namedItem("email").value.trim();
    const about = values.namedItem("about").value.trim();
    const skills = values.namedItem("skills").value.split(",").map((skill) => skill.trim()).filter(Boolean);
    const experience = values.namedItem("experience").value;
    const portfolioUrl = values.namedItem("portfolioUrl").value.trim();

    if (fullName.length < 2) nextErrors.fullName = "Enter your full name.";
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) nextErrors.username = "Use 3–20 letters, numbers or underscores.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = "Enter a valid email address.";
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      nextErrors.password = "Use at least 8 characters, including an uppercase letter, a lowercase letter and a number.";
    }
    if (password !== confirmPassword) nextErrors.confirmPassword = "Passwords do not match.";
    if (about.length < 20) nextErrors.about = "Tell customers a little more about yourself (at least 20 characters).";
    if (skills.length === 0) nextErrors.skills = "Add at least one skill, separated by commas.";
    if (!experience) nextErrors.experience = "Select your experience level.";
    if (errors.avatar) nextErrors.avatar = errors.avatar;
    if (portfolioUrl && !isHttpUrl(portfolioUrl)) nextErrors.portfolioUrl = "Enter a valid URL starting with http:// or https://.";
    if (!values.namedItem("terms").checked) nextErrors.terms = "You must agree to the Terms and Conditions to continue.";

    values.namedItem("password").value = "";
    values.namedItem("confirmPassword").value = "";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstInvalidField = Object.keys(nextErrors)[0];
      values.namedItem(firstInvalidField)?.focus();
      return;
    }

    navigate("/seller/profile", {
      state: {
        sellerDraft: {
          fullName,
          username,
          email,
          about,
          skills,
          experience,
          portfolioUrl,
          avatar: avatarPreview,
        },
      },
    });
  };

  return (
    <main className="market-section seller-page seller-form-page">
      <Link className="seller-back-link" to="/seller"><ArrowLeft size={14} /> Back to Become a Seller</Link>
      <div className="seller-form-layout">
        <section className="seller-form-intro">
          <SellerPageHeading
            eyebrow="YOUR SELLER PROFILE STARTS HERE"
            title="Create your seller account"
            description="A few details to get your TechStudio seller profile ready."
          />
          <div className="seller-form-aside-card">
            <span className="seller-form-aside-icon"><ShieldAlert size={20} /></span>
            <h2>Demo mode</h2>
            <p>No authentication service is connected. Your account will not be created or saved. Do not use a real or reused password.</p>
            <span className="seller-form-aside-step"><CheckCircle2 size={14} /> Create a profile preview</span>
            <span className="seller-form-aside-step"><CheckCircle2 size={14} /> Set up your seller page</span>
            <span className="seller-form-aside-step"><CheckCircle2 size={14} /> Explore the demo dashboard</span>
          </div>
        </section>

        <form className="seller-form-card" onSubmit={submitRegistration} noValidate>
          <div className="seller-form-card-heading">
            <span className="seller-form-step-number">01</span>
            <div><h2>Seller information</h2><p>Fields marked <span>*</span> are required.</p></div>
          </div>
          <div className="seller-form-grid">
            <div className="seller-field">
              <label htmlFor="sellerFullName">Full name <span>*</span></label>
              <input id="sellerFullName" name="fullName" autoComplete="name" defaultValue={existingDraft?.fullName || ""} onChange={clearError} placeholder="Your name" aria-invalid={Boolean(errors.fullName)} aria-describedby={errors.fullName ? "sellerFullName-error" : undefined} />
              <ErrorMessage id="sellerFullName-error">{errors.fullName}</ErrorMessage>
            </div>
            <div className="seller-field">
              <label htmlFor="sellerUsername">Username <span>*</span></label>
              <input id="sellerUsername" name="username" autoComplete="username" defaultValue={existingDraft?.username || ""} onChange={clearError} placeholder="e.g. samdev" aria-invalid={Boolean(errors.username)} aria-describedby={errors.username ? "sellerUsername-error" : "sellerUsername-help"} />
              <span className="seller-field-hint" id="sellerUsername-help">Availability cannot be checked in demo mode.</span>
              <ErrorMessage id="sellerUsername-error">{errors.username}</ErrorMessage>
            </div>
            <div className="seller-field seller-field-full">
              <label htmlFor="sellerEmail">Email address <span>*</span></label>
              <input id="sellerEmail" name="email" type="email" autoComplete="email" defaultValue={existingDraft?.email || ""} onChange={clearError} placeholder="you@example.com" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "sellerEmail-error" : undefined} />
              <ErrorMessage id="sellerEmail-error">{errors.email}</ErrorMessage>
            </div>
            <div className="seller-field">
              <label htmlFor="sellerPassword">Password <span>*</span></label>
              <div className="seller-password-control">
                <input id="sellerPassword" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" onChange={clearError} placeholder="At least 8 characters" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "sellerPassword-error" : "sellerPassword-help"} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
              <span className="seller-field-hint" id="sellerPassword-help">Uppercase, lowercase and a number. Never use a real password here.</span>
              <ErrorMessage id="sellerPassword-error">{errors.password}</ErrorMessage>
            </div>
            <div className="seller-field">
              <label htmlFor="sellerConfirmPassword">Confirm password <span>*</span></label>
              <div className="seller-password-control">
                <input id="sellerConfirmPassword" name="confirmPassword" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" onChange={clearError} placeholder="Re-enter your password" aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? "sellerConfirmPassword-error" : undefined} />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
              <ErrorMessage id="sellerConfirmPassword-error">{errors.confirmPassword}</ErrorMessage>
            </div>
            <div className="seller-field seller-field-full">
              <label htmlFor="sellerAvatar">Profile picture <span className="seller-optional">Optional · JPG, PNG or WebP up to 5 MB</span></label>
              <div className="seller-avatar-upload">
                <span className="seller-avatar-preview">{avatarPreview ? <img src={avatarPreview} alt="Profile preview" /> : <UserRound size={21} />}</span>
                <input id="sellerAvatar" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarChange} aria-describedby={errors.avatar ? "sellerAvatar-error" : "sellerAvatar-help"} aria-invalid={Boolean(errors.avatar)} />
              </div>
              <span className="seller-field-hint" id="sellerAvatar-help">This image is previewed locally only; it will not be uploaded.</span>
              <ErrorMessage id="sellerAvatar-error">{errors.avatar}</ErrorMessage>
            </div>
            <div className="seller-field seller-field-full">
              <label htmlFor="sellerAbout">About yourself <span>*</span></label>
              <textarea id="sellerAbout" name="about" rows="4" defaultValue={existingDraft?.about || ""} onChange={clearError} placeholder="Introduce yourself and the website projects you enjoy working on." aria-invalid={Boolean(errors.about)} aria-describedby={errors.about ? "sellerAbout-error" : undefined} />
              <ErrorMessage id="sellerAbout-error">{errors.about}</ErrorMessage>
            </div>
            <div className="seller-field seller-field-full">
              <label htmlFor="sellerSkills">Skills <span>*</span></label>
              <input id="sellerSkills" name="skills" defaultValue={existingDraft?.skills?.join(", ") || ""} onChange={clearError} placeholder="React, WordPress, UI design (separate with commas)" aria-invalid={Boolean(errors.skills)} aria-describedby={errors.skills ? "sellerSkills-error" : "sellerSkills-help"} />
              <span className="seller-field-hint" id="sellerSkills-help">Add skills and technologies, separated by commas.</span>
              <ErrorMessage id="sellerSkills-error">{errors.skills}</ErrorMessage>
            </div>
            <div className="seller-field">
              <label htmlFor="sellerExperience">Experience level <span>*</span></label>
              <select id="sellerExperience" name="experience" defaultValue={existingDraft?.experience || ""} onChange={clearError} aria-invalid={Boolean(errors.experience)} aria-describedby={errors.experience ? "sellerExperience-error" : undefined}>
                <option value="">Select experience</option>
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Experienced">Experienced</option>
              </select>
              <ErrorMessage id="sellerExperience-error">{errors.experience}</ErrorMessage>
            </div>
            <div className="seller-field">
              <label htmlFor="sellerPortfolioUrl">Portfolio website <span className="seller-optional">Optional</span></label>
              <input id="sellerPortfolioUrl" name="portfolioUrl" type="url" defaultValue={existingDraft?.portfolioUrl || ""} onChange={clearError} placeholder="https://yourportfolio.com" aria-invalid={Boolean(errors.portfolioUrl)} aria-describedby={errors.portfolioUrl ? "sellerPortfolioUrl-error" : undefined} />
              <ErrorMessage id="sellerPortfolioUrl-error">{errors.portfolioUrl}</ErrorMessage>
            </div>
            <div className="seller-field seller-field-full">
              <label className="seller-terms-label">
                <input id="sellerTerms" name="terms" type="checkbox" onChange={clearError} aria-invalid={Boolean(errors.terms)} aria-describedby={errors.terms ? "sellerTerms-error" : undefined} />
                <span>I agree to the <a href="mailto:hello@techstudio.pk?subject=Terms%20and%20conditions%20request">Terms and Conditions</a> <span>*</span></span>
              </label>
              <ErrorMessage id="sellerTerms-error">{errors.terms}</ErrorMessage>
            </div>
          </div>
          <button className="market-button market-button-primary seller-submit-button" type="submit">Create Seller Account <ArrowRight size={15} /></button>
          <p className="seller-form-footer">Already have an account? <Link to="/seller/login">Log in</Link></p>
          <p className="seller-no-password-note"><ShieldAlert size={13} /> Password fields are cleared when you continue and are never saved in this demo.</p>
        </form>
      </div>
    </main>
  );
}

export function SellerProfileSetup() {
  const location = useLocation();
  const navigate = useNavigate();
  const sellerDraft = location.state?.sellerDraft;
  const [profile, setProfile] = useState(() => ({
    displayName: sellerDraft?.displayName || sellerDraft?.fullName || "",
    professionalTitle: sellerDraft?.professionalTitle || "",
    about: sellerDraft?.about || "",
    skills: sellerDraft?.skills?.join(", ") || "",
    experience: sellerDraft?.experience || "",
    portfolioLinks: Array.isArray(sellerDraft?.portfolioLinks)
      ? sellerDraft.portfolioLinks.join("\n")
      : sellerDraft?.portfolioUrl || "",
    location: sellerDraft?.location || "",
    languages: sellerDraft?.languages || "",
    avatar: sellerDraft?.avatar || "",
  }));
  const [portfolioFiles, setPortfolioFiles] = useState(sellerDraft?.portfolioFiles || []);
  const [errors, setErrors] = useState({});
  const completedFields = ["displayName", "professionalTitle", "about", "skills", "experience"];
  const completion = Math.round((completedFields.filter((field) => profile[field].trim()).length / completedFields.length) * 100);

  if (!sellerDraft) return <Navigate to="/seller/register" replace />;

  const updateProfile = (event) => {
    const { name, value } = event.target;
    setProfile((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
  };

  const updateProfilePicture = (event) => {
    const file = event.target.files?.[0];
    setErrors((current) => ({ ...current, avatar: "" }));
    if (!file) return;
    if (!imageTypes.includes(file.type)) {
      setErrors((current) => ({ ...current, avatar: "Choose a JPG, PNG or WebP image." }));
      event.target.value = "";
      return;
    }
    if (file.size > maxAvatarSize) {
      setErrors((current) => ({ ...current, avatar: "Profile images must be 5 MB or smaller." }));
      event.target.value = "";
      return;
    }
    if (profile.avatar.startsWith("blob:")) URL.revokeObjectURL(profile.avatar);
    setProfile((current) => ({ ...current, avatar: URL.createObjectURL(file) }));
  };

  const updatePortfolioFiles = (event) => {
    const files = Array.from(event.target.files || []);
    const allowedFiles = [];
    let message = "";
    if (files.length > 5) message = "Choose up to 5 portfolio files.";
    files.slice(0, 5).forEach((file) => {
      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!allowedPortfolioExtensions.includes(extension)) message = "Use PDF, PNG, JPG or WebP portfolio files.";
      else if (file.size > maxPortfolioSize) message = "Each portfolio file must be 10 MB or smaller.";
      else allowedFiles.push(file.name);
    });
    setPortfolioFiles(allowedFiles);
    setErrors((current) => ({ ...current, portfolioFiles: message }));
    if (message) event.target.value = "";
  };

  const completeProfile = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!profile.displayName.trim()) nextErrors.displayName = "Enter a display name.";
    if (!profile.professionalTitle.trim()) nextErrors.professionalTitle = "Add your professional title.";
    if (profile.about.trim().length < 20) nextErrors.about = "Write at least 20 characters about yourself.";
    if (!profile.skills.trim()) nextErrors.skills = "Add at least one skill or technology.";
    if (!profile.experience) nextErrors.experience = "Select your experience level.";
    const portfolioLinks = profile.portfolioLinks.split(/\n|,/).map((url) => url.trim()).filter(Boolean);
    if (portfolioLinks.some((url) => !isHttpUrl(url))) nextErrors.portfolioLinks = "Enter valid portfolio URLs starting with http:// or https://.";
    if (errors.portfolioFiles) nextErrors.portfolioFiles = errors.portfolioFiles;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstInvalidField = Object.keys(nextErrors)[0];
      const fieldId = firstInvalidField === "portfolioFiles"
        ? "sellerPortfolioFiles"
        : firstInvalidField === "avatar"
          ? "sellerProfilePhoto"
          : `profile-${firstInvalidField}`;
      document.getElementById(fieldId)?.focus();
      return;
    }

    navigate("/seller/dashboard", {
      state: {
        sellerProfile: {
          ...sellerDraft,
          ...profile,
          skills: profile.skills.split(",").map((skill) => skill.trim()).filter(Boolean),
          portfolioLinks,
          portfolioFiles,
        },
      },
    });
  };

  return (
    <main className="market-section seller-page seller-profile-setup-page">
      <Link className="seller-back-link" to="/seller/register" state={{ sellerDraft }}><ArrowLeft size={14} /> Back to registration</Link>
      <SellerPageHeading
        eyebrow="STEP 02 · BUILD YOUR PROFILE"
        title="Set up your seller profile"
        description="A clear profile helps customers understand your experience and the work you do."
      />
      <DemoNotice>This is a local demo preview. No account has been created; profile details and selected files are not uploaded or saved to a server.</DemoNotice>

      <div className="seller-profile-setup-layout">
        <form className="seller-form-card seller-profile-form" onSubmit={completeProfile} noValidate>
          <div className="seller-form-card-heading">
            <span className="seller-form-step-number">02</span>
            <div><h2>Professional profile</h2><p>Fields marked <span>*</span> are needed for this preview.</p></div>
          </div>
          <div className="seller-profile-completion">
            <div className="seller-profile-completion-top"><span>Profile completion</span><strong>{completion}%</strong></div>
            <div className="seller-profile-progress" role="progressbar" aria-label="Profile completion" aria-valuenow={completion} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${completion}%` }} /></div>
            <small>Complete your display name, title, introduction, skills and experience.</small>
          </div>

          <div className="seller-profile-photo-row">
            <span className="seller-profile-photo">{profile.avatar ? <img src={profile.avatar} alt="Seller profile preview" /> : <UserRound size={24} />}</span>
            <div><strong>Profile picture</strong><p>JPG, PNG or WebP · Up to 5 MB · Not uploaded in demo</p>
              <label className="seller-upload-button" htmlFor="sellerProfilePhoto">Change picture</label>
              <input className="seller-visually-hidden" id="sellerProfilePhoto" type="file" accept="image/jpeg,image/png,image/webp" onChange={updateProfilePicture} aria-invalid={Boolean(errors.avatar)} aria-describedby={errors.avatar ? "profile-avatar-error" : undefined} />
              <ErrorMessage id="profile-avatar-error">{errors.avatar}</ErrorMessage>
            </div>
          </div>

          <div className="seller-form-grid">
            <div className="seller-field">
              <label htmlFor="profile-displayName">Display name <span>*</span></label>
              <input id="profile-displayName" name="displayName" value={profile.displayName} onChange={updateProfile} placeholder="Name customers will see" aria-invalid={Boolean(errors.displayName)} aria-describedby={errors.displayName ? "profile-displayName-error" : undefined} />
              <ErrorMessage id="profile-displayName-error">{errors.displayName}</ErrorMessage>
            </div>
            <div className="seller-field">
              <label htmlFor="profile-professionalTitle">Professional title <span>*</span></label>
              <input id="profile-professionalTitle" name="professionalTitle" value={profile.professionalTitle} onChange={updateProfile} placeholder="e.g. WordPress & React Developer" aria-invalid={Boolean(errors.professionalTitle)} aria-describedby={errors.professionalTitle ? "profile-professionalTitle-error" : undefined} />
              <ErrorMessage id="profile-professionalTitle-error">{errors.professionalTitle}</ErrorMessage>
            </div>
            <div className="seller-field seller-field-full">
              <label htmlFor="profile-about">About me <span>*</span></label>
              <textarea id="profile-about" name="about" rows="4" value={profile.about} onChange={updateProfile} placeholder="Describe your background, approach and the projects you enjoy." aria-invalid={Boolean(errors.about)} aria-describedby={errors.about ? "profile-about-error" : undefined} />
              <ErrorMessage id="profile-about-error">{errors.about}</ErrorMessage>
            </div>
            <div className="seller-field seller-field-full">
              <label htmlFor="profile-skills">Skills and technologies <span>*</span></label>
              <input id="profile-skills" name="skills" value={profile.skills} onChange={updateProfile} placeholder="React, WordPress, Figma" aria-invalid={Boolean(errors.skills)} aria-describedby={errors.skills ? "profile-skills-error" : "profile-skills-help"} />
              <span className="seller-field-hint" id="profile-skills-help">Separate skills with commas.</span>
              <ErrorMessage id="profile-skills-error">{errors.skills}</ErrorMessage>
            </div>
            <div className="seller-field">
              <label htmlFor="profile-experience">Experience <span>*</span></label>
              <select id="profile-experience" name="experience" value={profile.experience} onChange={updateProfile} aria-invalid={Boolean(errors.experience)} aria-describedby={errors.experience ? "profile-experience-error" : undefined}>
                <option value="">Select experience</option>
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Experienced">Experienced</option>
              </select>
              <ErrorMessage id="profile-experience-error">{errors.experience}</ErrorMessage>
            </div>
            <div className="seller-field">
              <label htmlFor="profile-location">Location <span className="seller-optional">Optional</span></label>
              <input id="profile-location" name="location" value={profile.location} onChange={updateProfile} placeholder="City, Country" />
            </div>
            <div className="seller-field seller-field-full">
              <label htmlFor="profile-portfolioLinks">Portfolio links <span className="seller-optional">Optional · One per line</span></label>
              <textarea id="profile-portfolioLinks" name="portfolioLinks" rows="3" value={profile.portfolioLinks} onChange={updateProfile} placeholder={"https://yourportfolio.com\nhttps://github.com/yourname"} aria-invalid={Boolean(errors.portfolioLinks)} aria-describedby={errors.portfolioLinks ? "profile-portfolioLinks-error" : undefined} />
              <ErrorMessage id="profile-portfolioLinks-error">{errors.portfolioLinks}</ErrorMessage>
            </div>
            <div className="seller-field seller-field-full">
              <label htmlFor="sellerPortfolioFiles">Portfolio samples <span className="seller-optional">Optional · Up to 5 files, 10 MB each</span></label>
              <div className="seller-portfolio-upload">
                <FileImage size={18} />
                <input id="sellerPortfolioFiles" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={updatePortfolioFiles} aria-invalid={Boolean(errors.portfolioFiles)} aria-describedby={errors.portfolioFiles ? "sellerPortfolioFiles-error" : "sellerPortfolioFiles-help"} />
              </div>
              <span className="seller-field-hint" id="sellerPortfolioFiles-help">PDF, PNG, JPG or WebP. Samples are selected locally and not uploaded.</span>
              <ErrorMessage id="sellerPortfolioFiles-error">{errors.portfolioFiles}</ErrorMessage>
              {portfolioFiles.length > 0 && <ul className="seller-uploaded-file-list">{portfolioFiles.map((name) => <li key={name}><Check size={13} /> {name}</li>)}</ul>}
            </div>
            <div className="seller-field seller-field-full">
              <label htmlFor="profile-languages">Languages <span className="seller-optional">Optional</span></label>
              <div className="seller-input-with-icon"><Languages size={15} /><input id="profile-languages" name="languages" value={profile.languages} onChange={updateProfile} placeholder="e.g. English, Urdu" /></div>
            </div>
          </div>
          <div className="seller-profile-form-actions">
            <Link className="market-button market-button-outline" to="/seller/register" state={{ sellerDraft }}>Back</Link>
            <button className="market-button market-button-primary" type="submit">Complete Profile <ArrowRight size={15} /></button>
          </div>
        </form>

        <aside className="seller-profile-preview">
          <span className="market-eyebrow">PROFILE PREVIEW</span>
          <div className="seller-profile-preview-avatar">{profile.avatar ? <img src={profile.avatar} alt="" /> : <UserRound size={24} />}</div>
          <h2>{profile.displayName || "Your display name"}</h2>
          <p>{profile.professionalTitle || "Your professional title"}</p>
          {profile.location && <span className="seller-profile-preview-location"><MapPin size={13} /> {profile.location}</span>}
          <div className="seller-profile-preview-divider" />
          <h3>About</h3>
          <p className="seller-profile-preview-about">{profile.about || "Your introduction will appear here."}</p>
          <h3>Skills</h3>
          <div className="seller-profile-skill-list">{profile.skills.split(",").map((skill) => skill.trim()).filter(Boolean).map((skill) => <span key={skill}>{skill}</span>)}</div>
          <div className="seller-profile-preview-experience"><BriefcaseBusiness size={14} /> {profile.experience || "Experience level"}</div>
          {profile.languages && <div className="seller-profile-preview-experience"><Globe2 size={14} /> {profile.languages}</div>}
        </aside>
      </div>
    </main>
  );
}

export function SellerDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const sellerProfile = location.state?.sellerProfile;
  const { getOwnedServices, deleteSellerService } = useMarketplace();
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleteNotice, setDeleteNotice] = useState("");

  if (!sellerProfile) return <Navigate to="/seller/register" replace />;

  const ownedServices = getOwnedServices(sellerProfile.username);
  const publishedServices = ownedServices.filter((service) => service.status === "published");
  const draftServices = ownedServices.filter((service) => service.status === "draft");
  const serviceResult = location.state?.serviceResult;
  const stats = [
    { Icon: BriefcaseBusiness, label: "My Services", value: String(ownedServices.length), message: "Published services and drafts in this session." },
    { Icon: Sparkles, label: "Active Orders", value: "0", message: "You don't have any active orders yet." },
    { Icon: CheckCircle2, label: "Completed Orders", value: "0", message: "Completed orders will be listed here." },
    { Icon: MessageCircle, label: "Messages", value: "Demo", message: "Open the session-only messaging preview." },
  ];

  const removeService = (service) => {
    if (!deleteSellerService(service.id, sellerProfile.username)) {
      setDeleteNotice("This service could not be deleted from the current seller preview.");
      return;
    }
    setDeleteNotice(`“${service.title}” was removed from this browser session.`);
    setDeleteCandidate(null);
  };

  const renderServices = (services, emptyMessage) => (
    services.length === 0
      ? <div className="seller-dashboard-service-empty"><BriefcaseBusiness size={19} /><p>{emptyMessage}</p></div>
      : <div className="seller-dashboard-service-list">
        {services.map((service) => (
          <article className="seller-dashboard-service-row" key={service.id}>
            <img src={service.image} alt="" />
            <div className="seller-dashboard-service-copy">
              <span className={`seller-service-status seller-service-status-${service.status}`}>{service.status === "published" ? "Published · Session preview" : "Draft · Session preview"}</span>
              <h3>{service.title}</h3>
              <p>{service.category} · {service.packages.length} {service.packages.length === 1 ? "package" : "packages"} · {service.price ? `From PKR ${new Intl.NumberFormat("en-PK").format(service.price)}` : "Pricing not set"}</p>
            </div>
            <div className="seller-dashboard-service-actions">
              {service.status === "published" && <Link className="seller-dashboard-service-link" to={`/services/${service.id}`}>View Service <ArrowUpRight size={13} /></Link>}
              <Link className="seller-dashboard-service-link" to={`/seller/services/${service.id}/edit`} state={{ sellerProfile }}><Pencil size={13} /> Edit Service</Link>
              <button className="seller-dashboard-service-delete" type="button" onClick={() => setDeleteCandidate(service.id)}><Trash2 size={13} /> Delete</button>
            </div>
            {deleteCandidate === service.id && (
              <div className="seller-dashboard-delete-confirm" role="group" aria-label={`Confirm deleting ${service.title}`}>
                <span>Delete this session-only service?</span>
                <button type="button" onClick={() => removeService(service)}>Delete service</button>
                <button type="button" onClick={() => setDeleteCandidate(null)}>Cancel</button>
              </div>
            )}
          </article>
        ))}
      </div>
  );

  return (
    <main className="market-section seller-page seller-dashboard-page">
      <div className="seller-dashboard-topline">
        <div><span className="market-eyebrow">SELLER WORKSPACE · DEMO</span><h1>Welcome, {sellerProfile.displayName}.</h1><p>Your seller dashboard preview is ready.</p></div>
        <button className="market-button market-button-outline" type="button" onClick={() => navigate("/seller/profile", { state: { sellerDraft: sellerProfile } })}>Edit Profile <ArrowUpRight size={14} /></button>
      </div>
      <DemoNotice>This is a demo dashboard. No account, profile, service, order or message data has been saved or uploaded to a server. Refreshing or leaving this flow may clear the preview.</DemoNotice>

      <section className="seller-dashboard-profile-card">
        <div className="seller-dashboard-profile-avatar">{sellerProfile.avatar ? <img src={sellerProfile.avatar} alt="" /> : <UserRound size={27} />}</div>
        <div className="seller-dashboard-profile-copy">
          <span className="seller-dashboard-profile-label">SELLER PROFILE PREVIEW</span>
          <h2>{sellerProfile.displayName}</h2>
          <p>{sellerProfile.professionalTitle}</p>
          <div className="seller-profile-skill-list">{sellerProfile.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
        </div>
        <div className="seller-dashboard-completion"><span>Profile completion</span><strong>100%</strong><span className="seller-dashboard-completion-track"><i /></span></div>
      </section>

      <div className="seller-dashboard-section-heading"><div><span className="market-eyebrow">YOUR SELLER ACTIVITY</span><h2>Your workspace</h2></div>
        <Link className="market-button market-button-primary" to="/seller/services/new" state={{ sellerProfile }}><Plus size={16} /> Create New Service</Link>
      </div>
      {serviceResult && (
        <div className="seller-dashboard-action-notice" role="status">
          <span>{serviceResult.status === "published" ? "Service published in this browser session:" : "Draft saved in this browser session:"} <strong>{serviceResult.title}</strong>. It is not stored on a server.</span>
          {serviceResult.status === "published"
            ? <Link to={`/services/${serviceResult.id}`}>View service <ArrowRight size={13} /></Link>
            : <Link to={`/seller/services/${serviceResult.id}/edit`} state={{ sellerProfile }}>Continue editing <ArrowRight size={13} /></Link>}
        </div>
      )}
      {deleteNotice && <div className="seller-dashboard-action-notice" role="status">{deleteNotice}</div>}

      <section className="seller-dashboard-grid" aria-label="Seller dashboard sections">
        {stats.map(({ Icon, label, value, message }) => (
          <article className="seller-dashboard-card" key={label}>
            <div className="seller-dashboard-card-top"><span><Icon size={17} /></span><strong>{value}</strong></div>
            <h3>{label}</h3>
            <p>{message}</p>
            {label === "My Services" && <Link to="/seller/services/new" state={{ sellerProfile }} className="seller-dashboard-text-button">Create your first service <ArrowRight size={13} /></Link>}
            {label === "Messages" && <Link to="/messages?role=seller" state={{ sellerProfile }} className="seller-dashboard-text-button">Open demo inbox <ArrowRight size={13} /></Link>}
          </article>
        ))}
      </section>
      <section className="seller-dashboard-managed-services">
        <div className="seller-dashboard-managed-heading"><div><span className="market-eyebrow">PUBLISHED SERVICES</span><h2>My Services</h2></div><span>{publishedServices.length}</span></div>
        {renderServices(publishedServices, "Your published services will appear here.")}
        <div className="seller-dashboard-managed-heading seller-dashboard-drafts-heading"><div><span className="market-eyebrow">WORK IN PROGRESS</span><h2>Drafts</h2></div><span>{draftServices.length}</span></div>
        {renderServices(draftServices, "You don't have any drafts yet. Save a service as a draft to continue later.")}
      </section>
      <div className="seller-dashboard-footer-link"><Link to="/services">Explore the customer marketplace <ArrowUpRight size={14} /></Link></div>
    </main>
  );
}

export function SellerLoginUnavailable() {
  return (
    <main className="market-section seller-page seller-login-page">
      <div className="seller-login-card">
        <span className="seller-login-icon"><ShieldAlert size={22} /></span>
        <span className="market-eyebrow">SELLER ACCOUNT ACCESS</span>
        <h1>Seller login isn’t available yet.</h1>
        <p>TechStudio’s authentication backend is not connected, so seller accounts and secure sign-in are not available in this demo.</p>
        <DemoNotice>No credentials are accepted or stored here. Please do not enter a real password.</DemoNotice>
        <div className="seller-login-actions">
          <Link className="market-button market-button-primary" to="/seller/register">Preview seller registration <ArrowRight size={15} /></Link>
          <Link className="market-button market-button-outline" to="/seller">Back to Become a Seller</Link>
        </div>
        <a className="seller-login-contact" href="mailto:hello@techstudio.pk?subject=TechStudio%20seller%20account%20access">Contact TechStudio support</a>
      </div>
    </main>
  );
}
