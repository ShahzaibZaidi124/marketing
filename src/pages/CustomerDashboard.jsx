import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageCircle,
  PackageCheck,
  PencilLine,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useMarketplace } from "../context/MarketplaceContext.jsx";
import {
  duplicateUsernameMessage,
  getDuplicateUsernameErrorMessage,
  getClientProfile,
  isClientProfileUsernameTaken,
  saveClientProfile,
  updateUserEmail,
  updateUserMetadata,
  updateUserPassword,
  verifyAuthenticatedUser,
} from "../lib/auth.js";
import {
  filterClientOrders,
  formatClientOrderDate,
  formatClientOrderPrice,
  formatClientOrderStatus,
  getClientOrder,
  getClientOrders,
  getOrderLoadErrorMessage,
} from "../lib/orders.js";
import { validateClientProfileDraft } from "../lib/profileValidation.js";
import {
  formatReviewRating,
  formatReviewStatus,
  getMyReviews,
  getReviewsLoadErrorMessage,
  getSubmitReviewErrorMessage,
  maximumReviewBodyLength,
  submitOrderReview,
  validateReviewDraft,
} from "../lib/reviews.js";

const customerNavigation = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "orders", label: "My Orders", Icon: ShoppingBag },
  { key: "active-orders", label: "Active Orders", Icon: Clock3 },
  { key: "completed-orders", label: "Completed Orders", Icon: CheckCircle2 },
  { key: "messages", label: "Messages", Icon: MessageCircle, to: "/messages" },
  { key: "saved", label: "Saved Services", Icon: Bookmark },
  { key: "reviews", label: "My Reviews", Icon: Star },
  { key: "profile", label: "Profile", Icon: UserRound, to: "/customer/profile" },
  { key: "settings", label: "Account Settings", Icon: Settings },
];

const orderStatusFilters = [
  { value: "all", label: "All Orders" },
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

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

function getAuthenticatedDisplayName(profile, metadata = {}) {
  const candidates = [profile?.full_name, metadata.full_name, metadata.name];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function formatOrderRequirement(value) {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (Array.isArray(value)) return value.join(", ") || "Not provided";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function OrderCard({ order }) {
  const status = ["pending", "active", "completed"].includes(order.status) ? order.status : "unknown";
  return (
    <article className="dashboard-order-card">
      <div className="dashboard-order-card-heading">
        <div>
          <span className="dashboard-order-id">Order ID · {order.id}</span>
          <h3>{order.service_name}</h3>
        </div>
        <span className={`dashboard-order-status dashboard-order-status-${status}`}>{formatClientOrderStatus(order.status)}</span>
      </div>
      {order.order_description && <p className="dashboard-order-project">{order.order_description}</p>}
      {order.project_name && <p className="dashboard-order-project">{order.project_name}</p>}
      <dl className="dashboard-order-meta">
        <div><dt>Order date</dt><dd>{formatClientOrderDate(order.created_at)}</dd></div>
        <div><dt>Price</dt><dd>{formatClientOrderPrice(order.price, order.currency)}</dd></div>
      </dl>
      <Link className="dashboard-order-details-link" to={`/customer/orders/${order.id}`}>
        View Details <ArrowRight size={15} />
      </Link>
    </article>
  );
}

function OrderCardSkeleton() {
  return (
    <article className="dashboard-order-card-skeleton" aria-hidden="true">
      <span className="dashboard-order-skeleton-line dashboard-order-skeleton-title" />
      <span className="dashboard-order-skeleton-line" />
      <span className="dashboard-order-skeleton-line dashboard-order-skeleton-short" />
    </article>
  );
}

function OrderDetails({ order, onBack }) {
  const requirements = order.requirements && typeof order.requirements === "object" && !Array.isArray(order.requirements)
    ? Object.entries(order.requirements)
    : [];
  const status = ["pending", "active", "completed"].includes(order.status) ? order.status : "unknown";

  return (
    <section className="dashboard-panel dashboard-order-details">
      <DashboardSectionHeading
        eyebrow="ORDER DETAILS"
        title={order.service_name}
        description={`Order ID · ${order.id}`}
        action={<button className="dashboard-text-link" type="button" onClick={onBack}>Back to My Orders</button>}
      />
      <div className="dashboard-order-detail-summary">
        <div>
          <span>Order status</span>
          <strong className={`dashboard-order-status dashboard-order-status-${status}`}>{formatClientOrderStatus(order.status)}</strong>
        </div>
        <div><span>Order date</span><strong>{formatClientOrderDate(order.created_at)}</strong></div>
        <div><span>Last updated</span><strong>{formatClientOrderDate(order.updated_at)}</strong></div>
        <div><span>Price</span><strong>{formatClientOrderPrice(order.price, order.currency)}</strong></div>
      </div>
      {(order.order_description || order.project_name || order.package_name || requirements.length > 0) && (
        <section className="dashboard-order-requirements">
          <h3>Order information</h3>
          <dl>
            {order.order_description && <div><dt>Description</dt><dd>{order.order_description}</dd></div>}
            {order.project_name && <div><dt>Project</dt><dd>{order.project_name}</dd></div>}
            {order.package_name && <div><dt>Package</dt><dd>{order.package_name}</dd></div>}
            {requirements.map(([key, value]) => (
              <div key={key}>
                <dt>{key.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</dt>
                <dd>{formatOrderRequirement(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </section>
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

function StarRatingInput({ value, onChange, disabled }) {
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;
  return (
    <span className="dashboard-review-star-input" role="radiogroup" aria-label="Rating from 1 to 5 stars">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`Rate ${star} star${star === 1 ? "" : "s"}`}
          className={star <= shown ? "active" : ""}
          disabled={disabled}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onFocus={() => setHovered(star)}
          onBlur={() => setHovered(0)}
        >
          <Star size={18} fill={star <= shown ? "currentColor" : "none"} />
        </button>
      ))}
      <span className="dashboard-review-star-value" aria-hidden="true">{value ? `${value}/5` : "Select a rating"}</span>
    </span>
  );
}

// One form per unreviewed completed order. The browser sends only the rating and
// the optional body — the database trigger derives the reviewer identity, the
// pending status and the moderation fields, so nothing here can forge them.
function ReviewForm({ order, onSubmitted }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const submittingRef = useRef(false);

  const submit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setFormError("");
    const { rating: safeRating, body: safeBody, error: validationError } = validateReviewDraft({ rating, body });
    if (validationError) {
      setFormError(validationError);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const review = await submitOrderReview({ orderId: order.id, rating: safeRating, body: safeBody });
      onSubmitted(review);
    } catch (error) {
      setFormError(getSubmitReviewErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form className="dashboard-review-form" onSubmit={submit} noValidate>
      <div className="dashboard-review-form-heading">
        <h3>{order.service_name}</h3>
        <small>Order ID · {order.id}</small>
      </div>
      <label>
        Your rating
        <StarRatingInput value={rating} onChange={setRating} disabled={submitting} />
      </label>
      <label>
        Your feedback <span className="dashboard-review-counter">Optional · {Array.from(body).length}/{maximumReviewBodyLength}</span>
        <textarea
          rows="4"
          maxLength={maximumReviewBodyLength}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Share what went well or what could be improved."
          disabled={submitting}
        />
      </label>
      {formError && <p className="dashboard-form-error" role="alert">{formError}</p>}
      <button className="market-button market-button-primary" type="submit" disabled={submitting || rating === 0}>
        {submitting ? "Submitting…" : "Submit review"}
      </button>
    </form>
  );
}

function ReviewsSection() {
  const { user, loading: authLoading } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return undefined;
    }
    if (!user?.id) {
      setReviews([]);
      setOrders([]);
      setError("");
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError("");
    Promise.all([getMyReviews(user.id), getClientOrders(user.id)])
      .then(([loadedReviews, loadedOrders]) => {
        if (!active) return;
        setReviews(loadedReviews);
        setOrders(loadedOrders);
      })
      .catch((loadError) => {
        if (active) setError(getReviewsLoadErrorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, user?.id, loadAttempt]);

  const reviewedOrderIds = useMemo(
    () => new Set(reviews.map((review) => review.order_id)),
    [reviews],
  );
  const completedOrders = useMemo(
    () => orders.filter((order) => order.status === "completed"),
    [orders],
  );
  const awaitingReview = completedOrders.filter((order) => !reviewedOrderIds.has(order.id));

  const handleSubmitted = (review) => {
    setReviews((current) => [review, ...current]);
    setNotice("Thanks! Your review was submitted and is awaiting moderation.");
  };

  return (
    <section className="dashboard-panel">
      <DashboardSectionHeading
        eyebrow="YOUR FEEDBACK"
        title="My reviews"
        description="Review the orders you have completed. Each completed order can be reviewed once, and submitted reviews cannot be changed."
      />
      {notice && <p className="dashboard-form-success" role="status">{notice}</p>}
      {authLoading || loading
        ? <div className="dashboard-review-loading" role="status" aria-label="Loading your reviews">
          <span className="dashboard-order-skeleton-line dashboard-order-skeleton-title" />
          <span className="dashboard-order-skeleton-line" />
        </div>
        : !user
          ? <EmptyState icon={Star} title="Sign in to review your orders">Your reviews are private to your NexTech account.</EmptyState>
          : error
            ? <div className="dashboard-orders-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry</button>
            </div>
            : <>
              {awaitingReview.length > 0 && (
                <>
                  <h3 className="dashboard-review-subheading">Awaiting your review</h3>
                  <div className="dashboard-review-list">
                    {awaitingReview.map((order) => (
                      <article className="dashboard-review-card" key={order.id}>
                        <ReviewForm order={order} onSubmitted={handleSubmitted} />
                      </article>
                    ))}
                  </div>
                </>
              )}
              <h3 className="dashboard-review-subheading">Submitted reviews</h3>
              {reviews.length === 0
                ? <EmptyState icon={Star} title="No reviews yet">
                  {completedOrders.length === 0
                    ? "You can review an order once it has been completed."
                    : "Complete a review above to see it listed here."}
                </EmptyState>
                : <div className="dashboard-review-list">
                  {reviews.map((review) => {
                    const statusKey = ["pending", "published", "rejected"].includes(review.status) ? review.status : "pending";
                    return (
                      <article className="dashboard-review-card" key={review.id}>
                        <div className="dashboard-review-card-heading">
                          <div>
                            <span className="dashboard-review-rating" aria-label={`${review.rating} out of 5 stars`}>{formatReviewRating(review.rating)}</span>
                            <small>Submitted {formatClientOrderDate(review.created_at)}</small>
                          </div>
                          <span className={`dashboard-review-status dashboard-review-status-${statusKey}`}>{formatReviewStatus(review.status)}</span>
                        </div>
                        {review.body
                          ? <p className="dashboard-review-body">{review.body}</p>
                          : <p className="dashboard-review-body dashboard-review-empty-body">No written feedback was added.</p>}
                      </article>
                    );
                  })}
                </div>}
            </>}
    </section>
  );
}

export default function CustomerDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId } = useParams();
  const { user, loading: authLoading, profilePictureUrl } = useAuth();
  const {
    allServices,
    savedServiceIds,
    removeSavedService,
    recentlyViewedServiceIds,
    customerProfile,
    updateCustomerProfile,
  } = useMarketplace();
  const [activeSection, setActiveSection] = useState(() => orderId
    ? "order-details"
    : location.state?.section === "profile"
      ? "profile"
      : location.state?.section === "orders"
        ? "orders"
        : "overview");
  const [orderStatus, setOrderStatus] = useState("all");
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [ordersLoadAttempt, setOrdersLoadAttempt] = useState(0);
  const [orderDetail, setOrderDetail] = useState(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [orderDetailError, setOrderDetailError] = useState("");
  const [orderDetailLoadAttempt, setOrderDetailLoadAttempt] = useState(0);
  const [profileForm, setProfileForm] = useState(customerProfile);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [profileFieldErrors, setProfileFieldErrors] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);
  const savingProfileRef = useRef(false);
  const [preferences, setPreferences] = useState({ orderUpdates: true, marketplaceUpdates: false });
  const [dashboardDisplayName, setDashboardDisplayName] = useState("");
  const [dashboardProfileLoading, setDashboardProfileLoading] = useState(false);
  const [dashboardProfileError, setDashboardProfileError] = useState("");
  const [dashboardProfileLoadAttempt, setDashboardProfileLoadAttempt] = useState(0);
  const hydratedUserId = useRef("");

  useEffect(() => {
    if (orderId) {
      setActiveSection("order-details");
      return;
    }
    if (["orders", "active-orders", "completed-orders", "profile", "saved", "reviews", "settings"].includes(location.state?.section)) {
      setActiveSection(location.state.section);
    }
  }, [orderId, location.state?.section]);

  useEffect(() => {
    if (!user) {
      hydratedUserId.current = "";
      setDashboardDisplayName("");
      return;
    }
    if (hydratedUserId.current === user.id) return;
    hydratedUserId.current = user.id;
    const metadata = user.user_metadata || {};
    const profile = {
      displayName: getAuthenticatedDisplayName(null, metadata),
      username: metadata.username || "",
      email: user.email || "",
      country: metadata.country || "",
      city: metadata.city || "",
      description: metadata.about || "",
      interests: metadata.services_interested || "",
    };
    setDashboardDisplayName(profile.displayName);
    setProfileForm((current) => ({ ...current, ...profile }));
    updateCustomerProfile(profile);
  }, [user, updateCustomerProfile]);

  useEffect(() => {
    if (!user?.id) {
      setDashboardProfileLoading(false);
      setDashboardProfileError("");
      return undefined;
    }

    let active = true;
    const metadata = user.user_metadata || {};
    setDashboardProfileLoading(true);
    setDashboardProfileError("");
    getClientProfile(user.id)
      .then((profile) => {
        if (!active) return;
        const nextProfile = {
          displayName: getAuthenticatedDisplayName(profile, metadata),
          username: profile?.username ?? metadata.username ?? "",
          email: user.email || "",
          country: profile?.country ?? metadata.country ?? "",
          city: profile?.city ?? metadata.city ?? "",
          description: profile?.bio ?? metadata.about ?? metadata.bio ?? "",
          interests: profile?.services_interested ?? metadata.services_interested ?? metadata.interests ?? "",
        };
        setDashboardDisplayName(nextProfile.displayName);
        setProfileForm((current) => ({ ...current, ...nextProfile }));
        updateCustomerProfile(nextProfile);
      })
      .catch((error) => {
        if (!active) return;
        setDashboardProfileError(error instanceof Error
          ? error.message
          : "Your account profile could not be loaded from Supabase.");
      })
      .finally(() => {
        if (active) setDashboardProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id, user?.email, user?.user_metadata, dashboardProfileLoadAttempt, updateCustomerProfile]);

  useEffect(() => {
    if (authLoading) {
      setOrdersLoading(true);
      return undefined;
    }
    if (!user?.id) {
      setOrders([]);
      setOrdersError("");
      setOrdersLoading(false);
      return undefined;
    }
    if (orderId) {
      setOrders([]);
      setOrdersError("");
      setOrdersLoading(false);
      return undefined;
    }

    let active = true;
    setOrders([]);
    setOrdersError("");
    setOrdersLoading(true);
    getClientOrders(user.id)
      .then((loadedOrders) => {
        if (active) setOrders(loadedOrders);
      })
      .catch((error) => {
        if (active) setOrdersError(getOrderLoadErrorMessage(error));
      })
      .finally(() => {
        if (active) setOrdersLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, user?.id, orderId, ordersLoadAttempt]);

  useEffect(() => {
    if (!orderId) {
      setOrderDetail(null);
      setOrderDetailError("");
      setOrderDetailLoading(false);
      return undefined;
    }
    if (authLoading) {
      setOrderDetailLoading(true);
      return undefined;
    }
    if (!user?.id) {
      setOrderDetail(null);
      setOrderDetailError("");
      setOrderDetailLoading(false);
      return undefined;
    }

    let active = true;
    setOrderDetail(null);
    setOrderDetailError("");
    setOrderDetailLoading(true);
    getClientOrder(user.id, orderId)
      .then((loadedOrder) => {
        if (active) setOrderDetail(loadedOrder);
      })
      .catch((error) => {
        if (active) setOrderDetailError(getOrderLoadErrorMessage(error));
      })
      .finally(() => {
        if (active) setOrderDetailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orderId, user?.id, authLoading, orderDetailLoadAttempt]);

  const savedServices = useMemo(
    () => savedServiceIds.map((id) => allServices.find((service) => service.id === id)).filter(Boolean),
    [allServices, savedServiceIds],
  );
  const recentlyViewed = useMemo(
    () => recentlyViewedServiceIds.map((id) => allServices.find((service) => service.id === id)).filter(Boolean),
    [allServices, recentlyViewedServiceIds],
  );
  const effectiveOrderStatus = activeSection === "active-orders"
    ? "active"
    : activeSection === "completed-orders"
      ? "completed"
      : orderStatus;
  const filteredOrders = useMemo(
    () => filterClientOrders(orders, effectiveOrderStatus),
    [orders, effectiveOrderStatus],
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
    let profileSavedToSupabase = false;
    try {
      if (user) {
        await verifyAuthenticatedUser(user.id);
        if (await isClientProfileUsernameTaken({ userId: user.id, username: nextProfile.username })) {
          setProfileFieldErrors((current) => ({ ...current, username: duplicateUsernameMessage }));
          document.getElementById("customer-username")?.focus();
          return;
        }
        await saveClientProfile({
          userId: user.id,
          email: user.email || "",
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
        profileSavedToSupabase = true;
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
        if (updatedUser.email !== user.email) {
          await saveClientProfile({
            userId: savedUser.id,
            email: updatedUser.email || user.email || "",
            role: user.user_metadata?.role === "seller" ? "seller" : "customer",
            sellerDetails: user.user_metadata?.seller_details || {},
            profile: {},
          });
        }
        setProfileNotice(profileForm.email.trim() !== (user.email || "")
          ? "Your profile was saved. Check your email to confirm the new address."
          : "Your client profile was saved to your account.");
      } else {
        setProfileNotice("Your profile preview was updated in this browser session.");
      }
      updateCustomerProfile(nextProfile);
      setProfileForm(nextProfile);
    } catch (error) {
      const duplicateMessage = getDuplicateUsernameErrorMessage(error);
      if (duplicateMessage) {
        setProfileFieldErrors((current) => ({ ...current, username: duplicateMessage }));
        document.getElementById("customer-username")?.focus();
      }
      const message = error instanceof Error ? error.message : "Your profile could not be saved. Please try again.";
      if (profileSavedToSupabase) {
        updateCustomerProfile(nextProfile);
        setProfileForm(nextProfile);
      }
      setProfileError(duplicateMessage ? "" : profileSavedToSupabase
        ? `Your profile was saved, but account details could not be updated: ${message}`
        : message);
    } finally {
      savingProfileRef.current = false;
      setSavingProfile(false);
    }
  };

  const navigation = [
    ...customerNavigation,
    { key: "logout", label: "Log out", Icon: LogOut },
  ];

  const selectDashboardSection = (section) => {
    if (orderId) {
      navigate("/customer/dashboard", { state: { section } });
      return;
    }
    setActiveSection(section);
  };
  const currentSection = orderId ? "order-details" : activeSection;

  const renderOrderStatistics = () => {
    const countByStatus = (status) => orders.filter((order) => order.status === status).length;
    const orderDataReady = Boolean(user && !authLoading && !ordersLoading && !ordersError);
    const unavailableText = authLoading || ordersLoading
      ? "Loading order data…"
      : !user
        ? "Sign in to view your orders."
        : "Order data couldn't be loaded.";
    const summaries = [
      { label: "Total orders", Icon: ShoppingBag, count: orders.length },
      { label: "Active orders", Icon: Clock3, count: countByStatus("active") },
      { label: "Completed orders", Icon: PackageCheck, count: countByStatus("completed") },
      { label: "Pending orders", Icon: Clock3, count: countByStatus("pending") },
    ];

    return summaries.map(({ label, Icon, count }) => (
      <article className="dashboard-stat-card dashboard-order-stat" key={label}>
        <span><Icon size={17} /></span>
        <small>{label}</small>
        <strong aria-label={orderDataReady ? `${label}: ${count}` : `${label} unavailable`}>
          {orderDataReady ? count.toLocaleString("en") : "—"}
        </strong>
        <p>{orderDataReady ? "From your saved order history." : unavailableText}</p>
      </article>
    ));
  };

  const renderOrders = () => (
    <section className="dashboard-panel">
      <DashboardSectionHeading
        eyebrow="PROJECT HISTORY"
        title={currentSection === "active-orders" ? "Active orders" : currentSection === "completed-orders" ? "Completed orders" : "My orders"}
        description="Orders shown here are loaded from your authenticated account."
      />
      {location.state?.orderCreated && (
        <p className="dashboard-form-success" role="status">Your order was created successfully and is now listed below.</p>
      )}
      <div className="dashboard-order-filters" role="group" aria-label="Filter orders by status">
        {orderStatusFilters.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={effectiveOrderStatus === value ? "active" : ""}
            aria-pressed={effectiveOrderStatus === value}
            onClick={() => {
              setOrderStatus(value);
              setActiveSection("orders");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {authLoading || ordersLoading
        ? <div className="dashboard-order-list" role="status" aria-label="Loading orders">
          {Array.from({ length: 3 }, (_, index) => <OrderCardSkeleton key={index} />)}
        </div>
        : !user
          ? <EmptyState icon={ShoppingBag} title="Sign in to view your orders">Your order history is private to your NexTech account.</EmptyState>
          : ordersError
            ? <div className="dashboard-orders-error" role="alert">
              <p>{ordersError}</p>
              <button type="button" onClick={() => setOrdersLoadAttempt((attempt) => attempt + 1)}>Retry</button>
            </div>
            : orders.length === 0
              ? <EmptyState icon={ShoppingBag} title="No orders yet">
                Orders linked to your account will appear here once they have been created.
              </EmptyState>
              : filteredOrders.length === 0
                ? <EmptyState icon={ShoppingBag} title="No orders match this filter">Try another status to see your order history.</EmptyState>
                : <div className="dashboard-order-list">{filteredOrders.map((order) => <OrderCard key={order.id} order={order} />)}</div>}
    </section>
  );

  const renderOrderDetails = () => (
    orderDetailLoading || authLoading
      ? <section className="dashboard-panel dashboard-order-details" role="status" aria-label="Loading order details">
        <div className="dashboard-order-details-skeleton">
          <OrderCardSkeleton />
          <OrderCardSkeleton />
        </div>
      </section>
      : !user
        ? <section className="dashboard-panel"><EmptyState icon={ShoppingBag} title="Sign in to view order details">Order details are private to the client account that placed the order.</EmptyState></section>
        : orderDetailError
          ? <section className="dashboard-panel dashboard-orders-error" role="alert">
            <p>{orderDetailError}</p>
            <button type="button" onClick={() => setOrderDetailLoadAttempt((attempt) => attempt + 1)}>Retry</button>
            <button type="button" onClick={() => navigate("/customer/dashboard", { state: { section: "orders" } })}>Back to My Orders</button>
          </section>
          : !orderDetail
            ? <section className="dashboard-panel">
              <DashboardSectionHeading eyebrow="ORDER DETAILS" title="Order not found" action={<button className="dashboard-text-link" type="button" onClick={() => navigate("/customer/dashboard", { state: { section: "orders" } })}>Back to My Orders</button>} />
              <EmptyState icon={ShoppingBag} title="This order isn't available">It may not exist, or it may not belong to your account.</EmptyState>
            </section>
            : <OrderDetails
              order={orderDetail}
              onBack={() => navigate("/customer/dashboard", { state: { section: "orders" } })}
            />
  );

  const renderOverview = () => (
    <>
      <section className="dashboard-welcome-card" aria-labelledby="customer-welcome-title">
        <div className="dashboard-welcome-copy">
          <span className="market-eyebrow">YOUR CLIENT WORKSPACE</span>
          <h2 id="customer-welcome-title">{dashboardDisplayName ? `Welcome back, ${dashboardDisplayName}` : "Welcome to your dashboard"}</h2>
          <p>Explore services, keep track of your shortlist, and manage your client profile.</p>
          {dashboardProfileLoading && <p className="dashboard-profile-loading" role="status">Loading your account profile…</p>}
          {dashboardProfileError && (
            <div className="dashboard-profile-load-error" role="alert">
              <span>{dashboardProfileError}</span>
              <button type="button" onClick={() => setDashboardProfileLoadAttempt((attempt) => attempt + 1)}>Try again</button>
            </div>
          )}
        </div>
        <div className="dashboard-welcome-mark" aria-hidden="true"><Sparkles size={25} /></div>
      </section>

      <section className="dashboard-stat-grid" aria-label="Order summary">
        {renderOrderStatistics()}
      </section>

      <div className="dashboard-overview-grid">
        <section className="dashboard-panel dashboard-recent-orders">
          <DashboardSectionHeading
            eyebrow="ORDER ACTIVITY"
            title="Recent orders"
            description="Order history is shown only when real records are available."
            action={orders.length > 0 && <button className="dashboard-text-link" type="button" onClick={() => setActiveSection("orders")}>All orders <ArrowRight size={14} /></button>}
          />
          {authLoading || ordersLoading
            ? <div className="dashboard-order-list" role="status" aria-label="Loading recent orders"><OrderCardSkeleton /><OrderCardSkeleton /></div>
            : !user
              ? <EmptyState icon={ShoppingBag} title="Sign in to view your orders">Your recent orders are private to your NexTech account.</EmptyState>
              : ordersError
                ? <div className="dashboard-orders-error" role="alert">
                  <p>{ordersError}</p>
                  <button type="button" onClick={() => setOrdersLoadAttempt((attempt) => attempt + 1)}>Retry</button>
                </div>
                : orders.length === 0
                  ? <EmptyState icon={ShoppingBag} title="No orders yet">Real orders linked to your account will appear here.</EmptyState>
                  : <div className="dashboard-order-list">{orders.slice(0, 3).map((order) => <OrderCard key={order.id} order={order} />)}</div>}
        </section>
        <section className="dashboard-panel dashboard-quick-actions-panel">
          <DashboardSectionHeading eyebrow="GET STARTED" title="Quick actions" />
          <div className="dashboard-quick-actions">
            <Link className="dashboard-quick-action" to="/services">
              <span><Search size={17} /></span>
              <strong>Explore Services</strong>
              <ArrowRight size={16} />
            </Link>
            <button className="dashboard-quick-action" type="button" onClick={() => setActiveSection("orders")}>
              <span><ShoppingBag size={17} /></span>
              <strong>View My Orders</strong>
              <ArrowRight size={16} />
            </button>
            <Link className="dashboard-quick-action" to="/customer/profile">
              <span><PencilLine size={17} /></span>
              <strong>Edit Profile</strong>
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </div>

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

  const renderReviews = () => <ReviewsSection />;

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
  if (orderId) content = renderOrderDetails();
  else if (["orders", "active-orders", "completed-orders"].includes(currentSection)) content = renderOrders();
  else if (currentSection === "saved") content = renderSavedServices();
  else if (currentSection === "reviews") content = renderReviews();
  else if (currentSection === "profile") content = renderProfile();
  else if (currentSection === "settings") content = <AccountSettings preferences={preferences} setPreferences={setPreferences} />;

  const displayName = dashboardDisplayName.trim();

  return (
    <DashboardLayout
      role="CUSTOMER"
      displayName={displayName || "Customer"}
      avatar={profilePictureUrl}
      activeSection={currentSection}
      navigation={navigation}
      onSelect={selectDashboardSection}
    >
      {content}
    </DashboardLayout>
  );
}
