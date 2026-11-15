import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageCircle,
  PackageCheck,
  Settings,
  ShoppingBag,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useMarketplace } from "../context/MarketplaceContext.jsx";
import {
  saveClientProfile,
  updateUserEmail,
  updateUserMetadata,
  updateUserPassword,
  verifyAuthenticatedUser,
} from "../lib/auth.js";
import { validateClientProfileDraft } from "../lib/profileValidation.js";

const customerNavigation = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "orders", label: "My Orders", Icon: ShoppingBag },
  { key: "active-orders", label: "Active Orders", Icon: Clock3 },
  { key: "completed-orders", label: "Completed Orders", Icon: CheckCircle2 },
  { key: "messages", label: "Messages", Icon: MessageCircle, to: "/messages?role=customer" },
  { key: "saved", label: "Saved Services", Icon: Bookmark },
  { key: "reviews", label: "My Reviews", Icon: Star },
  { key: "profile", label: "Profile", Icon: UserRound, to: "/customer/profile" },
  { key: "settings", label: "Account Settings", Icon: Settings },
];

const orderStatuses = ["All", "Pending", "In Progress", "Delivered", "Completed", "Cancelled"];

function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="dashboard-empty-state">
      <span><Icon size={20} /></span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

function DashboardSectionHeading({ eyebrow, title, description, action }) {
  return (
    <header className="dashboard-section-heading">
      <div>
        <span className="market-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

function CustomerServiceCard({ service, onRemove }) {
  return (
    <article className="dashboard-service-card">
      <Link to={`/services/${service.id}`} className="dashboard-service-image" aria-label={`View ${service.title}`}>
        <img src={service.image} alt="" />
      </Link>
      <div className="dashboard-service-copy">
        <span>{service.ownerUsername ? "Seller preview" : "Sample listing"} · {service.category}</span>
        <h3><Link to={`/services/${service.id}`}>{service.title}</Link></h3>
        <p>{service.seller}</p>
        <strong>From PKR {new Intl.NumberFormat("en-PK").format(service.price)}</strong>
      </div>
      <div className="dashboard-service-actions">
        <Link to={`/services/${service.id}`} aria-label={`Open ${service.title}`}><ExternalLink size={15} /> View</Link>
        <button type="button" onClick={() => onRemove(service.id)} aria-label={`Remove ${service.title} from saved services`}>
          <Trash2 size={15} /> Remove
        </button>
      </div>
    </article>
  );
}

function AccountSettings({ preferences, setPreferences }) {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordNotice("");
    if (!user) {
      setPasswordError("Sign in to change your account password.");
      return;
    }
    if (!password) {
      setPasswordError("Enter a new password.");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("The passwords do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      await updateUserPassword(password);
      setPassword("");
      setConfirmPassword("");
      setPasswordNotice("Your password was changed.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Your password could not be changed. Please try again.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <>
      <section className="dashboard-panel">
        <DashboardSectionHeading
          eyebrow="YOUR PREFERENCES"
          title="Account settings"
          description="Manage your account security and marketplace preferences."
        />
        <div className="dashboard-settings-list">
          <label><span><strong>Order updates</strong><small>There is no order service connected to send notifications.</small></span><input type="checkbox" checked={preferences.orderUpdates} onChange={(event) => setPreferences((current) => ({ ...current, orderUpdates: event.target.checked }))} /></label>
          <label><span><strong>Marketplace announcements</strong><small>Optional product and marketplace updates.</small></span><input type="checkbox" checked={preferences.marketplaceUpdates} onChange={(event) => setPreferences((current) => ({ ...current, marketplaceUpdates: event.target.checked }))} /></label>
        </div>
        <p className="dashboard-inline-note">Preference changes are kept in page state only and do not update a server account.</p>
      </section>
      <section className="dashboard-panel">
        <DashboardSectionHeading eyebrow="ACCOUNT SECURITY" title="Change password" description={user ? "Choose a new password for your client account." : "Sign in to update your account password."} />
        <form className="dashboard-password-form" onSubmit={changePassword}>
          <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={!user || savingPassword} /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required disabled={!user || savingPassword} /></label>
          {passwordError && <p className="dashboard-form-error" role="alert">{passwordError}</p>}
          {passwordNotice && <p className="dashboard-form-success" role="status">{passwordNotice}</p>}
          <button className="market-button market-button-primary" type="submit" disabled={!user || savingPassword}>{savingPassword ? "Updating…" : "Update password"}</button>
        </form>
      </section>
    </>
  );
}

export default function CustomerDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profilePictureUrl } = useAuth();
  const {
    allServices,
    savedServiceIds,
    removeSavedService,
    recentlyViewedServiceIds,
    customerProfile,
    updateCustomerProfile,
  } = useMarketplace();
  const [activeSection, setActiveSection] = useState(() => location.state?.section === "profile" ? "profile" : "overview");
  const [orderStatus, setOrderStatus] = useState("All");
  const [profileForm, setProfileForm] = useState(customerProfile);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [profileFieldErrors, setProfileFieldErrors] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);
  const savingProfileRef = useRef(false);
  const [preferences, setPreferences] = useState({ orderUpdates: true, marketplaceUpdates: false });
  const hydratedUserId = useRef("");

  useEffect(() => {
    if (!user || hydratedUserId.current === user.id) return;
    hydratedUserId.current = user.id;
    const metadata = user.user_metadata || {};
    const profile = {
      displayName: metadata.full_name || metadata.name || "",
      username: metadata.username || "",
      email: user.email || "",
      country: metadata.country || "",
      city: metadata.city || "",
      description: metadata.about || "",
      interests: metadata.services_interested || "",
    };
    setProfileForm((current) => ({ ...current, ...profile }));
    updateCustomerProfile(profile);
  }, [user, updateCustomerProfile]);

  const savedServices = useMemo(
    () => savedServiceIds.map((id) => allServices.find((service) => service.id === id)).filter(Boolean),
    [allServices, savedServiceIds],
  );
  const recentlyViewed = useMemo(
    () => recentlyViewedServiceIds.map((id) => allServices.find((service) => service.id === id)).filter(Boolean),
    [allServices, recentlyViewedServiceIds],
  );

  const updateProfileField = (event) => {
    const { name, value } = event.target;
    setProfileForm((current) => ({ ...current, [name]: value }));
    setProfileFieldErrors((current) => ({ ...current, [name]: "" }));
    setProfileError("");
    setProfileNotice("");
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    if (savingProfileRef.current) return;
    setProfileError("");
    setProfileNotice("");
    const { values, errors } = validateClientProfileDraft({
      fullName: profileForm.displayName,
      username: profileForm.username,
      country: profileForm.country,
      city: profileForm.city,
      bio: profileForm.description,
      serviceInterests: profileForm.interests,
      projectInterests: "",
    });
    setProfileFieldErrors({
      displayName: errors.fullName,
      username: errors.username,
      country: errors.country,
      description: errors.bio,
    });
    if (Object.keys(errors).length > 0) {
      const field = errors.fullName ? "customer-display-name"
        : errors.username ? "customer-username"
          : errors.country ? "customer-country"
            : "customer-description";
      document.getElementById(field)?.focus();
      return;
    }
    if (profileForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.email.trim())) {
      setProfileError("Enter a valid email address.");
      document.getElementById("customer-email")?.focus();
      return;
    }
    setProfileError("");
    setProfileNotice("");
    const nextProfile = {
      ...profileForm,
      displayName: values.fullName,
      username: values.username,
      email: profileForm.email.trim(),
      country: values.country,
      city: values.city,
      description: values.bio,
      interests: values.serviceInterests,
    };
    savingProfileRef.current = true;
    setSavingProfile(true);
    try {
      if (user) {
        await verifyAuthenticatedUser(user.id);
        const updatedUser = profileForm.email.trim() !== (user.email || "")
          ? await updateUserEmail(nextProfile.email)
          : user;
        await verifyAuthenticatedUser(user.id);
        const savedUser = await updateUserMetadata({
          full_name: nextProfile.displayName,
          username: nextProfile.username,
          country: nextProfile.country,
          city: nextProfile.city,
          about: nextProfile.description,
          services_interested: nextProfile.interests,
          role: user.user_metadata?.role === "seller" ? "seller" : "customer",
        });
        await saveClientProfile({
          userId: savedUser.id,
          email: updatedUser.email || user.email,
          role: user.user_metadata?.role === "seller" ? "seller" : "customer",
          sellerDetails: user.user_metadata?.seller_details || {},
          profile: {
            fullName: nextProfile.displayName,
            username: nextProfile.username,
            country: nextProfile.country,
            city: nextProfile.city,
            bio: nextProfile.description,
            servicesInterested: nextProfile.interests,
          },
        });
        setProfileNotice(profileForm.email.trim() !== (user.email || "")
          ? "Your profile was saved. Check your email to confirm the new address."
          : "Your client profile was saved to your account.");
      } else {
        setProfileNotice("Your profile preview was updated in this browser session.");
      }
      updateCustomerProfile(nextProfile);
      setProfileForm(nextProfile);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Your profile could not be saved. Please try again.");
    } finally {
      savingProfileRef.current = false;
      setSavingProfile(false);
    }
  };

  const navigation = [
    ...customerNavigation,
    { key: "logout", label: "Log out", Icon: LogOut },
  ];

  const renderOrders = () => (
    <section className="dashboard-panel">
      <DashboardSectionHeading
        eyebrow="PROJECT HISTORY"
        title={activeSection === "active-orders" ? "Active orders" : activeSection === "completed-orders" ? "Completed orders" : "My orders"}
        description="Order records and progress are unavailable because checkout is demo-only."
      />
      <div className="dashboard-order-filters" aria-label="Filter orders by status">
        {orderStatuses.map((status) => (
          <button key={status} type="button" className={orderStatus === status ? "active" : ""} aria-pressed={orderStatus === status} onClick={() => setOrderStatus(status)}>
            {status}
          </button>
        ))}
      </div>
      <EmptyState icon={ShoppingBag} title="No order records to show">
        Order submissions are not sent or saved in this demo, so there are no real order numbers, sellers, prices, dates, deadlines, or statuses to display.
      </EmptyState>
    </section>
  );

  const renderOverview = () => (
    <>
      <section className="dashboard-stat-grid" aria-label="Customer overview">
        <article className="dashboard-stat-card"><span><ShoppingBag size={17} /></span><small>Total orders</small><strong>Unavailable</strong><p>No order records are connected.</p></article>
        <article className="dashboard-stat-card"><span><Clock3 size={17} /></span><small>Active orders</small><strong>Unavailable</strong><p>Order status tracking is not available.</p></article>
        <article className="dashboard-stat-card"><span><PackageCheck size={17} /></span><small>Completed orders</small><strong>Unavailable</strong><p>Completed orders are not stored.</p></article>
        <article className="dashboard-stat-card"><span><BookmarkCheck size={17} /></span><small>Saved services</small><strong>{savedServices.length}</strong><p>Saved in this browser session only.</p></article>
      </section>
      <div className="dashboard-overview-grid">
        <section className="dashboard-panel">
          <DashboardSectionHeading eyebrow="ORDER ACTIVITY" title="Recent order activity" />
          <EmptyState icon={ShoppingBag} title="No order activity yet">
            There is no order backend connected. Orders submitted from checkout are not saved.
          </EmptyState>
        </section>
        <section className="dashboard-panel">
          <DashboardSectionHeading
            eyebrow="YOUR SHORTLIST"
            title="Recently viewed services"
            action={recentlyViewed.length > 0 && <button className="dashboard-text-link" type="button" onClick={() => setActiveSection("saved")}>Saved services <ArrowRight size={14} /></button>}
          />
          {recentlyViewed.length === 0
            ? <EmptyState icon={Clock3} title="No recently viewed services">Open a service page and it will appear here for this browser session.</EmptyState>
            : <div className="dashboard-recent-list">{recentlyViewed.slice(0, 3).map((service) => (
              <Link className="dashboard-recent-row" to={`/services/${service.id}`} key={service.id}>
                <img src={service.image} alt="" /><span><strong>{service.title}</strong><small>{service.seller}</small></span><ArrowRight size={14} />
              </Link>
            ))}</div>}
        </section>
      </div>
    </>
  );

  const renderSavedServices = () => (
    <section className="dashboard-panel">
      <DashboardSectionHeading eyebrow="YOUR SHORTLIST" title="Saved services" description="Saved items are only stored in the current app session." />
      {savedServices.length === 0
        ? <EmptyState icon={Bookmark} title="No saved services yet">
          Save a service from Explore Services or its details page to keep it on this list.
        </EmptyState>
        : <div className="dashboard-service-list">{savedServices.map((service) => <CustomerServiceCard key={service.id} service={service} onRemove={removeSavedService} />)}</div>}
      <div className="dashboard-panel-footer"><Link to="/services" className="market-button market-button-primary">Explore services <ArrowRight size={15} /></Link></div>
    </section>
  );

  const renderReviews = () => (
    <section className="dashboard-panel">
      <DashboardSectionHeading eyebrow="YOUR FEEDBACK" title="My reviews" description="Reviews are not connected to an order or review service." />
      <EmptyState icon={Star} title="No reviews available">
        NexTech has no review backend, and this demo does not create ratings or review records.
      </EmptyState>
    </section>
  );

  const renderProfile = () => (
    <section className="dashboard-panel">
      <DashboardSectionHeading eyebrow="CLIENT PROFILE" title="Edit profile" description="Keep your client details and service preferences up to date." />
      <form className="dashboard-profile-form" onSubmit={saveProfile} noValidate>
        <div className="dashboard-profile-summary">
          <strong>Client account</strong>
          <span>Member since {user?.created_at
            ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(user.created_at))
            : "November 2026"}</span>
          {(profileForm.country || profileForm.city) && <div><MapPin size={13} /> {[profileForm.city, profileForm.country].filter(Boolean).join(", ")}</div>}
          <div><CalendarDays size={13} /> Account type: Client</div>
        </div>
        <div className="dashboard-avatar-editor">
          {profilePictureUrl ? <img src={profilePictureUrl} alt="Customer profile" /> : <span><UserRound size={25} /></span>}
          <div className="dashboard-avatar-editor-copy"><strong>Profile picture</strong><small>Using your NexTech picture or Google account photo.</small></div>
          <Link className="dashboard-avatar-editor-link" to="/customer/profile">Edit picture</Link>
        </div>
        <div className="dashboard-form-grid">
          <label>
            Full name
            <input id="customer-display-name" name="displayName" value={profileForm.displayName} onChange={updateProfileField} autoComplete="name" minLength={2} required aria-invalid={Boolean(profileFieldErrors.displayName)} aria-describedby={profileFieldErrors.displayName ? "customer-display-name-error" : undefined} />
            {profileFieldErrors.displayName && <small className="dashboard-field-error" id="customer-display-name-error" role="alert">{profileFieldErrors.displayName}</small>}
          </label>
          <label>
            Username
            <input id="customer-username" name="username" value={profileForm.username} onChange={updateProfileField} autoComplete="username" minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" required aria-invalid={Boolean(profileFieldErrors.username)} aria-describedby={profileFieldErrors.username ? "customer-username-error" : undefined} />
            {profileFieldErrors.username && <small className="dashboard-field-error" id="customer-username-error" role="alert">{profileFieldErrors.username}</small>}
          </label>
          <label>Email address<input id="customer-email" name="email" type="email" value={profileForm.email} onChange={updateProfileField} autoComplete="email" /></label>
          <label>
            Country
            <input id="customer-country" name="country" value={profileForm.country} onChange={updateProfileField} autoComplete="country-name" required aria-invalid={Boolean(profileFieldErrors.country)} aria-describedby={profileFieldErrors.country ? "customer-country-error" : undefined} />
            {profileFieldErrors.country && <small className="dashboard-field-error" id="customer-country-error" role="alert">{profileFieldErrors.country}</small>}
          </label>
          <label>City<input name="city" value={profileForm.city} onChange={updateProfileField} autoComplete="address-level2" /></label>
          <label className="dashboard-form-full">
            About me
            <textarea id="customer-description" name="description" rows="3" maxLength={300} value={profileForm.description} onChange={updateProfileField} placeholder="Add a short introduction." aria-invalid={Boolean(profileFieldErrors.description)} aria-describedby={profileFieldErrors.description ? "customer-description-error" : undefined} />
            {profileFieldErrors.description && <small className="dashboard-field-error" id="customer-description-error" role="alert">{profileFieldErrors.description}</small>}
          </label>
          <label className="dashboard-form-full">Services you're interested in<textarea name="interests" rows="3" value={profileForm.interests} onChange={updateProfileField} placeholder="For example: websites, branding, or e-commerce." /></label>
        </div>
        {profileError && <p className="dashboard-form-error" role="alert">{profileError}</p>}
        {profileNotice && <p className="dashboard-form-success" role="status">{profileNotice}</p>}
        <button className="market-button market-button-primary" type="submit" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save profile"} <ArrowRight size={15} /></button>
      </form>
    </section>
  );

  let content = renderOverview();
  if (["orders", "active-orders", "completed-orders"].includes(activeSection)) content = renderOrders();
  else if (activeSection === "saved") content = renderSavedServices();
  else if (activeSection === "reviews") content = renderReviews();
  else if (activeSection === "profile") content = renderProfile();
  else if (activeSection === "settings") content = <AccountSettings preferences={preferences} setPreferences={setPreferences} />;

  return (
    <DashboardLayout
      role="CUSTOMER"
      displayName={customerProfile.displayName || "Customer"}
      avatar={profilePictureUrl}
      activeSection={activeSection}
      navigation={navigation}
      onSelect={setActiveSection}
    >
      {content}
    </DashboardLayout>
  );
}
