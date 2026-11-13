import { useMemo, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  PackageCheck,
  Settings,
  ShoppingBag,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout.jsx";
import { useMarketplace } from "../context/MarketplaceContext.jsx";

const customerNavigation = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "orders", label: "My Orders", Icon: ShoppingBag },
  { key: "active-orders", label: "Active Orders", Icon: Clock3 },
  { key: "completed-orders", label: "Completed Orders", Icon: CheckCircle2 },
  { key: "messages", label: "Messages", Icon: MessageCircle, to: "/messages?role=customer" },
  { key: "saved", label: "Saved Services", Icon: Bookmark },
  { key: "reviews", label: "My Reviews", Icon: Star },
  { key: "profile", label: "Edit Profile", Icon: UserRound },
  { key: "settings", label: "Account Settings", Icon: Settings },
];

const orderStatuses = ["All", "Pending", "In Progress", "Delivered", "Completed", "Cancelled"];
const allowedAvatarTypes = ["image/jpeg", "image/png", "image/webp"];
const maxAvatarSize = 5 * 1024 * 1024;

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
  return (
    <section className="dashboard-panel">
      <DashboardSectionHeading
        eyebrow="YOUR PREFERENCES"
        title="Account settings"
        description="These settings apply only to this browser preview."
      />
      <div className="dashboard-settings-list">
        <label><span><strong>Order updates</strong><small>There is no order service connected to send notifications.</small></span><input type="checkbox" checked={preferences.orderUpdates} onChange={(event) => setPreferences((current) => ({ ...current, orderUpdates: event.target.checked }))} /></label>
        <label><span><strong>Marketplace announcements</strong><small>Optional product and marketplace updates.</small></span><input type="checkbox" checked={preferences.marketplaceUpdates} onChange={(event) => setPreferences((current) => ({ ...current, marketplaceUpdates: event.target.checked }))} /></label>
      </div>
      <p className="dashboard-inline-note">Preference changes are kept in page state only and do not update a server account.</p>
    </section>
  );
}

export default function CustomerDashboard() {
  const navigate = useNavigate();
  const {
    allServices,
    savedServiceIds,
    removeSavedService,
    recentlyViewedServiceIds,
    customerProfile,
    updateCustomerProfile,
  } = useMarketplace();
  const [activeSection, setActiveSection] = useState("overview");
  const [orderStatus, setOrderStatus] = useState("All");
  const [profileForm, setProfileForm] = useState(customerProfile);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [preferences, setPreferences] = useState({ orderUpdates: true, marketplaceUpdates: false });

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
    setProfileError("");
    setProfileNotice("");
  };

  const updateAvatar = (event) => {
    const file = event.target.files?.[0];
    setProfileError("");
    if (!file) return;
    if (!allowedAvatarTypes.includes(file.type)) {
      setProfileError("Choose a JPG, PNG, or WebP profile picture.");
      event.target.value = "";
      return;
    }
    if (file.size > maxAvatarSize) {
      setProfileError("Profile pictures must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }
    const previousAvatar = profileForm.avatar;
    if (previousAvatar.startsWith("blob:")) URL.revokeObjectURL(previousAvatar);
    setProfileForm((current) => ({ ...current, avatar: URL.createObjectURL(file) }));
  };

  const saveProfile = (event) => {
    event.preventDefault();
    if (!profileForm.displayName.trim()) {
      setProfileError("Enter a display name.");
      document.getElementById("customer-display-name")?.focus();
      return;
    }
    if (profileForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.email.trim())) {
      setProfileError("Enter a valid email address.");
      document.getElementById("customer-email")?.focus();
      return;
    }
    const nextProfile = { ...profileForm, displayName: profileForm.displayName.trim(), email: profileForm.email.trim() };
    updateCustomerProfile(nextProfile);
    setProfileForm(nextProfile);
    setProfileError("");
    setProfileNotice("Your profile preview was updated in this browser session.");
  };

  const navigation = [
    ...customerNavigation,
    { key: "logout", label: "Logout", Icon: LogOut, onClick: () => navigate("/") },
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
        TechStudio has no review backend, and this demo does not create ratings or review records.
      </EmptyState>
    </section>
  );

  const renderProfile = () => (
    <section className="dashboard-panel">
      <DashboardSectionHeading eyebrow="CUSTOMER PROFILE" title="Edit profile" description="Edit the profile preview shown in this browser session." />
      <form className="dashboard-profile-form" onSubmit={saveProfile} noValidate>
        <div className="dashboard-avatar-editor">
          {profileForm.avatar ? <img src={profileForm.avatar} alt="Customer profile preview" /> : <span><UserRound size={25} /></span>}
          <label htmlFor="customer-avatar">Change picture <small>JPG, PNG, or WebP · Up to 5 MB · Local only</small></label>
          <input id="customer-avatar" type="file" accept="image/jpeg,image/png,image/webp" onChange={updateAvatar} />
        </div>
        <div className="dashboard-form-grid">
          <label>Display name<input id="customer-display-name" name="displayName" value={profileForm.displayName} onChange={updateProfileField} autoComplete="name" required /></label>
          <label>Email address<input id="customer-email" name="email" type="email" value={profileForm.email} onChange={updateProfileField} autoComplete="email" /></label>
          <label>Contact number<input name="phone" type="tel" value={profileForm.phone} onChange={updateProfileField} autoComplete="tel" /></label>
          <label className="dashboard-form-full">About you<textarea name="description" rows="4" value={profileForm.description} onChange={updateProfileField} placeholder="Add a short introduction." /></label>
        </div>
        {profileError && <p className="dashboard-form-error" role="alert">{profileError}</p>}
        {profileNotice && <p className="dashboard-form-success" role="status">{profileNotice}</p>}
        <button className="market-button market-button-primary" type="submit">Save profile preview <ArrowRight size={15} /></button>
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
      avatar={customerProfile.avatar}
      activeSection={activeSection}
      navigation={navigation}
      onSelect={setActiveSection}
    >
      {content}
    </DashboardLayout>
  );
}
