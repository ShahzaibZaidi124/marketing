import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  Menu,
  MessageCircle,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  Star,
  Store,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { isOwnerAccount } from "../lib/messages.js";
import { getAdminOverview, getAdminOverviewErrorMessage } from "../lib/adminOverview.js";
import {
  filterCustomerDirectory,
  formatCustomerCreatedDate,
  getAdminCustomerDirectory,
  getAdminCustomerDirectoryErrorMessage,
} from "../lib/adminCustomerDirectory.js";
import {
  filterAdminServices,
  getAdminServicesDirectory,
  getAdminServicesDirectoryErrorMessage,
} from "../lib/adminServicesDirectory.js";
import {
  filterAdminOrders,
  getAdminOrdersDirectory,
  getAdminOrdersDirectoryErrorMessage,
} from "../lib/adminOrdersDirectory.js";
import {
  adminReviewStatuses,
  filterAdminReviews,
  getAdminReviewsDirectory,
  getAdminReviewsDirectoryErrorMessage,
} from "../lib/adminReviewsDirectory.js";
import {
  adminReportStatuses,
  filterAdminReports,
  formatReportCategory,
  formatReportStatus,
  formatReportTargetType,
  getAdminReportsDirectory,
  getAdminReportsDirectoryErrorMessage,
} from "../lib/adminReportsDirectory.js";
import {
  createServiceCategory,
  deleteServiceCategory,
  duplicateCategoryNameError,
  filterServiceCategories,
  getAdminServiceCategories,
  getDeleteCategoryErrorMessage,
  getSaveCategoryErrorMessage,
  getServiceCategoriesErrorMessage,
  maximumCategoryDescriptionLength,
  maximumCategoryIconNameLength,
  maximumCategoryNameLength,
  reassignServiceCategory,
  updateServiceCategory,
} from "../lib/serviceCategories.js";
import { formatReviewRating, formatReviewStatus } from "../lib/reviews.js";
import {
  formatClientOrderDate,
  formatClientOrderPrice,
  formatClientOrderStatus,
} from "../lib/orders.js";
import AdminMessages from "./AdminMessages.jsx";
import { RequireOwner } from "../components/RouteGuards.jsx";

const navigation = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "messages", label: "Messages", Icon: MessageCircle },
  { key: "users", label: "Users", Icon: UserRound },
  { key: "sellers", label: "Sellers", Icon: Store },
  { key: "services", label: "Services", Icon: BriefcaseBusiness },
  { key: "orders", label: "Orders", Icon: ShoppingBag },
  { key: "reviews", label: "Reviews", Icon: Star },
  { key: "reports", label: "Reports", Icon: ClipboardList },
  { key: "categories", label: "Categories", Icon: FolderKanban },
  { key: "settings", label: "Platform settings", Icon: Settings },
  { key: "activity", label: "Activity log", Icon: Activity },
];

// Sections only the website owner may see. Hiding the link is defence-in-depth;
// each of these sections also carries a server-verified RequireOwner gate so a
// direct URL is blocked for approved admins and customers.
const ownerOnlyKeys = ["messages", "settings"];

// The only status filter the live catalog supports: the real is_active column.
// Preview-only statuses (pending/published/rejected) are not database fields and
// are not offered here.
const serviceStatusOptions = ["all", "active", "inactive"];

// The only status filter the live orders directory supports: the real status
// column, whose allowed values are pending / active / completed / rejected.
const orderStatusOptions = ["all", "pending", "active", "completed", "rejected"];

// The only status filter the live reviews directory supports: the real
// reviews.status column, whose allowed values are pending / published / rejected.
const reviewStatusOptions = ["all", ...adminReviewStatuses];

// The only status filter the live reports directory supports: the real
// reports.status column, whose allowed values are pending / reviewing / resolved
// / rejected (pending and reviewing are the open states).
const reportStatusOptions = ["all", ...adminReportStatuses];

// The only status filter the live categories directory supports: the real
// is_active column, whose values are active / inactive.
const categoryStatusOptions = ["all", "active", "inactive"];

function formatStatus(status) {
  return status === "published" ? "Published" : status.charAt(0).toUpperCase() + status.slice(1);
}

function EmptyState({ title, children }) {
  return (
    <div className="admin-empty">
      <span><FolderKanban size={20} /></span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function AdminPageHeading({ eyebrow, title, children }) {
  return (
    <header className="admin-page-heading">
      <div>
        <span className="market-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
    </header>
  );
}

function AdminDashboard() {
  const { pathname } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const activeSection = pathname.split("/")[2] || "overview";
  const activeItem = navigation.find((item) => item.key === activeSection) || navigation[0];
  const isMessagesSection = activeSection === "messages";
  const [isOwner, setIsOwner] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [serviceStatusFilter, setServiceStatusFilter] = useState("all");
  const [profileOpen, setProfileOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const [categoriesRefreshKey, setCategoriesRefreshKey] = useState(0);
  const [categoryStatusFilter, setCategoryStatusFilter] = useState("all");
  const [categoryForm, setCategoryForm] = useState({ id: "", name: "", description: "", iconName: "", active: true });
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryFormError, setCategoryFormError] = useState("");
  const [categoryBusyId, setCategoryBusyId] = useState("");
  const [reassignSource, setReassignSource] = useState(null);
  const [reassignTargetId, setReassignTargetId] = useState("");
  const [settings, setSettings] = useState({
    name: "NexTech",
    description: "",
    contactEmail: "",
    supportEmail: "",
  });
  const [activity, setActivity] = useState([]);
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState("");
  const [customersRefreshKey, setCustomersRefreshKey] = useState(0);
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState("");
  const [servicesRefreshKey, setServicesRefreshKey] = useState(0);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState("");
  const [reviewsRefreshKey, setReviewsRefreshKey] = useState(0);
  const [reviewStatusFilter, setReviewStatusFilter] = useState("all");
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [reportsRefreshKey, setReportsRefreshKey] = useState(0);
  const [reportStatusFilter, setReportStatusFilter] = useState("all");

  // The Overview shows real server data. An approved admin cannot read the
  // profiles/orders tables directly (RLS exposes them to the owner only), so the
  // totals come from the read-only admin_overview() RPC, which authorizes the
  // caller with has_admin_access() and returns only approved, non-identifying data.
  useEffect(() => {
    if (activeSection !== "overview") return undefined;
    if (authLoading) return undefined;

    if (!user) {
      setOverview(null);
      setOverviewError("");
      setOverviewLoading(false);
      return undefined;
    }

    let active = true;
    setOverviewLoading(true);
    setOverviewError("");

    getAdminOverview()
      .then((data) => { if (active) { setOverview(data); setOverviewError(""); } })
      .catch((error) => { if (active) { setOverview(null); setOverviewError(getAdminOverviewErrorMessage(error)); } })
      .finally(() => { if (active) setOverviewLoading(false); });

    return () => { active = false; };
  }, [activeSection, user, authLoading]);

  // The Users section is a live, read-only customer directory. An approved admin
  // cannot read other profiles directly (RLS exposes them to the owner only), so
  // the list comes from the read-only admin_customer_directory() RPC, which
  // authorizes the caller with has_admin_access() and returns only display fields.
  useEffect(() => {
    if (activeSection !== "users") return undefined;
    if (authLoading) return undefined;

    if (!user) {
      setCustomers([]);
      setCustomersError("");
      setCustomersLoading(false);
      return undefined;
    }

    let active = true;
    setCustomersLoading(true);
    setCustomersError("");

    getAdminCustomerDirectory()
      .then((data) => { if (active) { setCustomers(data); setCustomersError(""); } })
      .catch((error) => { if (active) { setCustomers([]); setCustomersError(getAdminCustomerDirectoryErrorMessage(error)); } })
      .finally(() => { if (active) setCustomersLoading(false); });

    return () => { active = false; };
  }, [activeSection, user, authLoading, customersRefreshKey]);

  // The Services section is a live, read-only catalog directory. An approved
  // admin can only read ACTIVE services through RLS (the owner-only policy exposes
  // the rest), so the list comes from the read-only admin_services_directory()
  // RPC, which authorizes the caller with has_admin_access() and returns only the
  // catalog display fields.
  useEffect(() => {
    if (activeSection !== "services") return undefined;
    if (authLoading) return undefined;

    if (!user) {
      setServices([]);
      setServicesError("");
      setServicesLoading(false);
      return undefined;
    }

    let active = true;
    setServicesLoading(true);
    setServicesError("");

    getAdminServicesDirectory()
      .then((data) => { if (active) { setServices(data); setServicesError(""); } })
      .catch((error) => { if (active) { setServices([]); setServicesError(getAdminServicesDirectoryErrorMessage(error)); } })
      .finally(() => { if (active) setServicesLoading(false); });

    return () => { active = false; };
  }, [activeSection, user, authLoading, servicesRefreshKey]);

  // The Orders section is a live, read-only directory. The only SELECT policies on
  // public.orders expose rows to the owning client and the owner; an approved admin
  // can read none of them directly. So the list comes from the read-only
  // admin_orders_directory() RPC, which authorizes the caller with
  // has_admin_access() and returns only the order display fields (no client id and
  // no client-written free text).
  useEffect(() => {
    if (activeSection !== "orders") return undefined;
    if (authLoading) return undefined;

    if (!user) {
      setOrders([]);
      setOrdersError("");
      setOrdersLoading(false);
      return undefined;
    }

    let active = true;
    setOrdersLoading(true);
    setOrdersError("");

    getAdminOrdersDirectory()
      .then((data) => { if (active) { setOrders(data); setOrdersError(""); } })
      .catch((error) => { if (active) { setOrders([]); setOrdersError(getAdminOrdersDirectoryErrorMessage(error)); } })
      .finally(() => { if (active) setOrdersLoading(false); });

    return () => { active = false; };
  }, [activeSection, user, authLoading, ordersRefreshKey]);

  // The Reviews section is a live, read-only directory. The only SELECT policies
  // on public.reviews expose rows to the reviewer and the owner; an approved admin
  // can read none of them directly. So the list comes from the read-only
  // admin_reviews_directory() RPC, which authorizes the caller with
  // has_admin_access() and returns only the review display fields (no reviewer id,
  // no moderator id and no moderation fields).
  useEffect(() => {
    if (activeSection !== "reviews") return undefined;
    if (authLoading) return undefined;

    if (!user) {
      setReviews([]);
      setReviewsError("");
      setReviewsLoading(false);
      return undefined;
    }

    let active = true;
    setReviewsLoading(true);
    setReviewsError("");

    getAdminReviewsDirectory()
      .then((data) => { if (active) { setReviews(data); setReviewsError(""); } })
      .catch((error) => { if (active) { setReviews([]); setReviewsError(getAdminReviewsDirectoryErrorMessage(error)); } })
      .finally(() => { if (active) setReviewsLoading(false); });

    return () => { active = false; };
  }, [activeSection, user, authLoading, reviewsRefreshKey]);

  // The Reports section is a live, read-only directory. The only SELECT policies
  // on public.reports expose rows to the reporter and the owner; an approved admin
  // can read none of them directly. So the list comes from the read-only
  // admin_reports_directory() RPC, which authorizes the caller with
  // has_admin_access() and returns only the report display fields (no reporter id,
  // no resolver id and no resolution fields).
  useEffect(() => {
    if (activeSection !== "reports") return undefined;
    if (authLoading) return undefined;

    if (!user) {
      setReports([]);
      setReportsError("");
      setReportsLoading(false);
      return undefined;
    }

    let active = true;
    setReportsLoading(true);
    setReportsError("");

    getAdminReportsDirectory()
      .then((data) => { if (active) { setReports(data); setReportsError(""); } })
      .catch((error) => { if (active) { setReports([]); setReportsError(getAdminReportsDirectoryErrorMessage(error)); } })
      .finally(() => { if (active) setReportsLoading(false); });

    return () => { active = false; };
  }, [activeSection, user, authLoading, reportsRefreshKey]);

  // The Categories section is a live, editable directory. Authenticated users can
  // read active categories; inactive rows and every write stay behind
  // has_admin_access()-gated RPCs. The browser never sends a role or a new row id.
  useEffect(() => {
    if (activeSection !== "categories") return undefined;
    if (authLoading) return undefined;

    if (!user) {
      setCategories([]);
      setCategoriesError("");
      setCategoriesLoading(false);
      return undefined;
    }

    let active = true;
    setCategoriesLoading(true);
    setCategoriesError("");

    getAdminServiceCategories()
      .then((data) => { if (active) { setCategories(data); setCategoriesError(""); } })
      .catch((error) => { if (active) { setCategories([]); setCategoriesError(getServiceCategoriesErrorMessage(error)); } })
      .finally(() => { if (active) setCategoriesLoading(false); });

    return () => { active = false; };
  }, [activeSection, user, authLoading, categoriesRefreshKey]);

  // The Messages and Platform Configuration links are owner-only and fail closed:
  // they stay hidden for guests, for customers, for approved admins and while the
  // server-side owner check is pending or unavailable. Hiding the link is only a
  // convenience — the inbox and the settings form keep their RequireOwner gate, so
  // a direct /admin/settings or /admin/messages URL is blocked too.
  useEffect(() => {
    if (authLoading) return undefined;
    if (!user) {
      setIsOwner(false);
      return undefined;
    }

    let active = true;
    isOwnerAccount()
      .then((owner) => { if (active) setIsOwner(owner); })
      .catch(() => { if (active) setIsOwner(false); });

    return () => { active = false; };
  }, [user, authLoading]);

  const visibleNavigation = useMemo(
    () => navigation.filter((item) => !ownerOnlyKeys.includes(item.key) || isOwner),
    [isOwner],
  );

  const filteredServicesList = useMemo(
    () => filterAdminServices(services, { query: search, status: serviceStatusFilter }),
    [services, search, serviceStatusFilter],
  );

  const filteredCustomers = useMemo(
    () => filterCustomerDirectory(customers, search),
    [customers, search],
  );

  const filteredOrdersList = useMemo(
    () => filterAdminOrders(orders, { query: search, status: orderStatusFilter }),
    [orders, search, orderStatusFilter],
  );

  const filteredReviewsList = useMemo(
    () => filterAdminReviews(reviews, { query: search, status: reviewStatusFilter }),
    [reviews, search, reviewStatusFilter],
  );

  const filteredReportsList = useMemo(
    () => filterAdminReports(reports, { query: search, status: reportStatusFilter }),
    [reports, search, reportStatusFilter],
  );

  const filteredCategoriesList = useMemo(
    () => filterServiceCategories(categories, { query: search, status: categoryStatusFilter }),
    [categories, search, categoryStatusFilter],
  );

  // Overview, Users, Services, Orders, Reviews, Reports and Categories are backed
  // by live server data (Categories is also editable); the remaining sections are
  // still browser previews.
  const isPreviewSection = !isMessagesSection
    && activeSection !== "overview"
    && activeSection !== "users"
    && activeSection !== "services"
    && activeSection !== "orders"
    && activeSection !== "reviews"
    && activeSection !== "reports"
    && activeSection !== "categories";

  const overviewStats = [
    { key: "customers", label: "Total customers", Icon: UserRound, hint: "Customer profiles on file", value: overview?.totalCustomers },
    { key: "services", label: "Published services", Icon: BriefcaseBusiness, hint: "Active services in the catalog", value: overview?.publishedServices },
    { key: "pending", label: "Pending orders", Icon: ClipboardList, hint: "Orders awaiting action", value: overview?.pendingOrders },
    { key: "orders", label: "Total orders", Icon: ShoppingBag, hint: "All customer orders", value: overview?.totalOrders },
  ];

  const logAction = (description) => {
    setActivity((current) => [{
      id: `${Date.now()}-${Math.random()}`,
      description,
      time: new Date().toLocaleString(),
    }, ...current]);
  };

  const resetCategoryForm = () => {
    setCategoryForm({ id: "", name: "", description: "", iconName: "", active: true });
    setCategoryFormError("");
  };

  const saveCategory = async (event) => {
    event.preventDefault();
    if (categorySaving) return;
    const duplicateError = duplicateCategoryNameError(categories, {
      name: categoryForm.name,
      id: categoryForm.id,
    });
    if (duplicateError) {
      setCategoryFormError(duplicateError);
      return;
    }

    setCategoryFormError("");
    setCategorySaving(true);

    try {
      if (categoryForm.id) {
        const updated = await updateServiceCategory({
          id: categoryForm.id,
          name: categoryForm.name,
          description: categoryForm.description,
          iconName: categoryForm.iconName,
          active: categoryForm.active,
        });
        setNotice(`Category “${updated?.name || categoryForm.name}” updated on the server.`);
      } else {
        const created = await createServiceCategory({
          name: categoryForm.name,
          description: categoryForm.description,
          iconName: categoryForm.iconName,
        });
        setNotice(`Category “${created?.name || categoryForm.name}” added on the server.`);
      }
      resetCategoryForm();
      setCategoriesRefreshKey((current) => current + 1);
    } catch (error) {
      setCategoryFormError(getSaveCategoryErrorMessage(error));
    } finally {
      setCategorySaving(false);
    }
  };

  const editCategory = (category) => {
    setCategoryFormError("");
    setReassignSource(null);
    setCategoryForm({
      id: category.id,
      name: category.name,
      description: category.description,
      iconName: category.iconName,
      active: category.active !== false,
    });
  };

  const performDeleteCategory = async (category) => {
    if (!window.confirm(`Delete the category “${category.name}”? This cannot be undone.`)) return;

    setCategoryBusyId(category.id);
    setCategoryFormError("");
    try {
      await deleteServiceCategory(category.id);
      if (categoryForm.id === category.id) resetCategoryForm();
      setNotice(`Category “${category.name}” deleted on the server.`);
      setCategoriesRefreshKey((current) => current + 1);
    } catch (error) {
      setCategoryFormError(getDeleteCategoryErrorMessage(error));
    } finally {
      setCategoryBusyId("");
    }
  };

  // A category that still has services cannot be deleted (the RPC refuses and the
  // ON DELETE RESTRICT foreign key backs it up), so the admin is offered a
  // reassignment step: move the services, then delete.
  const deleteCategory = (category) => {
    setCategoryFormError("");
    if (category.serviceCount > 0) {
      setReassignSource(category);
      setReassignTargetId("");
      return;
    }
    performDeleteCategory(category);
  };

  const reassignAndDelete = async () => {
    if (!reassignSource || !reassignTargetId) return;

    setCategoryBusyId(reassignSource.id);
    setCategoryFormError("");
    try {
      const moved = await reassignServiceCategory({ fromId: reassignSource.id, toId: reassignTargetId });
      await deleteServiceCategory(reassignSource.id);
      if (categoryForm.id === reassignSource.id) resetCategoryForm();
      setNotice(`Moved ${moved} service${moved === 1 ? "" : "s"} and deleted “${reassignSource.name}”.`);
      setReassignSource(null);
      setReassignTargetId("");
      setCategoriesRefreshKey((current) => current + 1);
    } catch (error) {
      setCategoryFormError(getDeleteCategoryErrorMessage(error));
    } finally {
      setCategoryBusyId("");
    }
  };

  const saveSettings = (event) => {
    event.preventDefault();
    setNotice("Settings updated in this browser preview only; they are not saved to a server.");
    logAction("Updated platform settings in preview");
  };

  const unavailableSections = {
    sellers: ["Seller management", "Seller profiles and application decisions are not available without an account and seller-application backend."],
  };

  return (
    <main className="admin-shell">
      <aside className={`admin-sidebar${sidebarOpen ? " open" : ""}`}>
        <Link className="admin-brand" to="/" aria-label="NexTech home">
          <span className="brand-mark"><span /></span>
          <span>NexTech<span className="brand-period">.</span></span>
        </Link>
        <div className="admin-side-label">WORKSPACE</div>
        <nav className="admin-navigation" aria-label="Admin dashboard navigation">
          {visibleNavigation.map(({ key, label, Icon }) => (
            <Link
              key={key}
              className={`admin-nav-link${activeSection === key ? " active" : ""}`}
              to={key === "overview" ? "/admin" : `/admin/${key}`}
              onClick={() => setSidebarOpen(false)}
              aria-current={activeSection === key ? "page" : undefined}
            >
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <Shield size={15} />
          <span>Server-verified access<br /><small>Owner &amp; approved admins</small></span>
        </div>
      </aside>

      {sidebarOpen && <button className="admin-sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <div className="admin-content">
        <header className="admin-topbar">
          <button className="admin-menu-toggle" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open dashboard navigation">
            <Menu size={19} />
          </button>
          {!isMessagesSection && (
            <div className="admin-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={`Search ${activeItem.label.toLowerCase()}`}
                placeholder={`Search ${activeItem.label.toLowerCase()}...`}
              />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}
            </div>
          )}
          <div className="admin-topbar-actions">
            <button type="button" className="admin-icon-button" aria-label="Notifications unavailable in preview" title="Notifications are not connected">
              <Bell size={17} />
            </button>
            <div className="admin-profile-wrap">
              <button className="admin-profile-button" type="button" onClick={() => setProfileOpen((current) => !current)} aria-expanded={profileOpen}>
                <span className="admin-avatar">TS</span>
                <span className="admin-profile-copy"><strong>Administrator</strong><small>Server-verified access</small></span>
                <ChevronDown size={14} />
              </button>
              {profileOpen && (
                <div className="admin-profile-menu">
                  <strong>Server-verified access</strong>
                  <p>Your admin access was confirmed on the server.</p>
                  <Link to="/admin-access" onClick={() => setProfileOpen(false)}>Admin access</Link>
                  <Link to="/" onClick={() => setProfileOpen(false)}>Visit marketplace</Link>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="admin-main">
          <div className="admin-heading-row">
            <div>
              <span className="market-eyebrow">NEXTECH · ADMIN WORKSPACE</span>
              <h1>{activeSection === "overview" ? "Platform overview" : activeItem.label}</h1>
              <p>{isMessagesSection
                ? "Read and reply to every customer conversation. Access is verified on the server before any message is written."
                : activeSection === "overview"
                  ? "Live totals and the most recent customer orders, read from the server for the owner and approved admins."
                  : activeSection === "users"
                    ? "Verified customer accounts read from the server. Account status is not tracked, so the real account role is shown."
                    : activeSection === "services"
                      ? "Live services read from the server for the owner and approved admins. This catalog view is read-only."
                      : activeSection === "orders"
                        ? "Live orders read from the server for the owner and approved admins. Client identity and client-written details are never shown, and this view is read-only."
                        : activeSection === "reviews"
                          ? "Live customer reviews read from the server for the owner and approved admins. Reviewer and moderator identities are never shown, and this view is read-only."
                          : activeSection === "reports"
                            ? "Live customer reports read from the server for the owner and approved admins. Reporter identity and personal information are never shown, and this view is read-only."
                            : activeSection === "categories"
                              ? "Live service categories stored on the server for the owner and approved admins. Changes here appear in the customer-facing service editor."
                              : "Manage your marketplace preview and review platform activity."}</p>
            </div>
            {isPreviewSection && <div className="admin-status-chip"><span /> Demo mode</div>}
          </div>

          {isPreviewSection && (
            <div className="admin-security-notice" role="note">
              <AlertTriangle size={17} />
              <p><strong>Access is verified; this section is still a preview.</strong> Entry to this dashboard is checked on the server against the owner record and approved admins. This section has no live records yet, and preview changes are kept in browser memory only.</p>
            </div>
          )}

          {notice && <div className="admin-action-notice" role="status"><CheckCircle2 size={16} />{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={14} /></button></div>}

          {isMessagesSection && (
            <RequireOwner>
              <AdminMessages />
            </RequireOwner>
          )}

          {activeSection === "overview" && (
            <>
              {overviewLoading && (
                <div className="admin-action-notice" role="status" aria-live="polite">
                  <Loader2 size={16} />
                  Loading live platform data from the server…
                </div>
              )}

              {!overviewLoading && overviewError && (
                <div className="admin-security-notice" role="alert">
                  <AlertTriangle size={17} />
                  <p><strong>Live data unavailable.</strong> {overviewError}</p>
                </div>
              )}

              <div className="admin-stats-grid">
                {overviewStats.map(({ key, label, Icon, hint, value }) => (
                  <article className="admin-stat-card" key={key}>
                    <span><Icon size={17} /></span>
                    <small>{label}</small>
                    <strong>{overviewLoading ? "…" : overviewError ? "Unavailable" : (value ?? "—")}</strong>
                    <p>{overviewError ? "Could not be read from the server" : hint}</p>
                  </article>
                ))}
              </div>

              <section className="admin-panel">
                <AdminPageHeading eyebrow="ORDER ACTIVITY" title="Recent orders">
                  The five most recent orders, read from the server. Customer identity is never included.
                </AdminPageHeading>
                {overviewLoading ? (
                  <EmptyState title="Loading recent orders">Fetching the latest orders from the server.</EmptyState>
                ) : overviewError ? (
                  <EmptyState title="Recent orders unavailable">{overviewError}</EmptyState>
                ) : overview?.recentOrders?.length ? (
                  <div className="admin-activity-list">
                    {overview.recentOrders.map((order, index) => (
                      <div className="admin-activity-row" key={`${order.createdAt}-${index}`}>
                        <span><ShoppingBag size={15} /></span>
                        <div>
                          <strong>{order.serviceName || "Service order"}{order.projectName ? ` · ${order.projectName}` : ""}</strong>
                          <small>{formatClientOrderStatus(order.status)} · {formatClientOrderPrice(order.price, order.currency)} · {formatClientOrderDate(order.createdAt)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No orders yet">When a customer places an order, it will appear here.</EmptyState>
                )}
              </section>
            </>
          )}

          {activeSection === "users" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="CUSTOMER DIRECTORY" title="Users">
                Verified customer accounts, read from the server for the owner and approved admins. Public profiles have no account-status field, so the real account role is shown instead of an invented status.
              </AdminPageHeading>

              <div className="admin-filter-row" role="group" aria-label="Customer directory actions">
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setCustomersRefreshKey((current) => current + 1)}
                  disabled={customersLoading}
                >
                  <RefreshCw size={14} aria-hidden="true" /> {customersLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {customersLoading && (
                <div className="admin-action-notice" role="status" aria-live="polite">
                  <Loader2 size={16} />
                  Loading the customer directory from the server…
                </div>
              )}

              {!customersLoading && customersError && (
                <div className="admin-security-notice" role="alert">
                  <AlertTriangle size={17} />
                  <p><strong>Customer directory unavailable.</strong> {customersError}</p>
                </div>
              )}

              {!customersLoading && !customersError && (filteredCustomers.length ? (
                <div className="admin-activity-list">
                  {filteredCustomers.map((customer, index) => (
                    <div className="admin-activity-row" key={`${customer.email}-${customer.createdAt}-${index}`}>
                      <span><UserRound size={15} /></span>
                      <div>
                        <strong>{customer.name || customer.username || "Unnamed customer"}</strong>
                        <small>
                          {[
                            customer.email || "No email on file",
                            customer.role ? formatStatus(customer.role) : "Customer",
                            formatCustomerCreatedDate(customer.createdAt),
                          ].join(" · ")}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : customers.length ? (
                <EmptyState title="No matching customers">No customer name matches this search. Try a different name.</EmptyState>
              ) : (
                <EmptyState title="No customer records yet">No verified customer accounts exist on the server yet.</EmptyState>
              ))}
            </section>
          )}

          {unavailableSections[activeSection] && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="DATA SOURCE UNAVAILABLE" title={unavailableSections[activeSection][0]} />
              <EmptyState title="No account data connected">{unavailableSections[activeSection][1]}</EmptyState>
            </section>
          )}

          {activeSection === "services" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="SERVICE CATALOG" title="Services">
                Live services, read from the server for the owner and approved admins. This directory stays read-only and shows the catalog fields the services directory returns.
              </AdminPageHeading>

              <div className="admin-filter-row" role="group" aria-label="Filter services by status">
                {serviceStatusOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={serviceStatusFilter === status ? "active" : ""}
                    onClick={() => setServiceStatusFilter(status)}
                  >
                    {status === "all" ? "All" : formatStatus(status)}
                  </button>
                ))}
              </div>

              <div className="admin-filter-row" role="group" aria-label="Services directory actions">
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setServicesRefreshKey((current) => current + 1)}
                  disabled={servicesLoading}
                >
                  <RefreshCw size={14} aria-hidden="true" /> {servicesLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {servicesLoading && (
                <div className="admin-action-notice" role="status" aria-live="polite">
                  <Loader2 size={16} />
                  Loading the services directory from the server…
                </div>
              )}

              {!servicesLoading && servicesError && (
                <div className="admin-security-notice" role="alert">
                  <AlertTriangle size={17} />
                  <p><strong>Services directory unavailable.</strong> {servicesError}</p>
                </div>
              )}

              {!servicesLoading && !servicesError && (filteredServicesList.length ? (
                <div className="admin-activity-list">
                  {filteredServicesList.map((service) => (
                    <div className="admin-activity-row" key={service.id}>
                      <span><BriefcaseBusiness size={15} /></span>
                      <div>
                        <strong>{service.name || "Untitled service"}</strong>
                        <small>{service.active ? "Active" : "Inactive"} · {formatClientOrderPrice(service.price, service.currency)} · Created {formatClientOrderDate(service.createdAt)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : services.length ? (
                <EmptyState title="No matching services">No service matches this search or status filter. Try a different term or filter.</EmptyState>
              ) : (
                <EmptyState title="No services yet">No services exist in the catalog on the server yet.</EmptyState>
              ))}
            </section>
          )}

          {activeSection === "orders" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="ORDER DIRECTORY" title="Orders">
                Live orders, read from the server for the owner and approved admins. Customer identity and the customer's written description and requirements are private and are never shown. This view is read-only.
              </AdminPageHeading>

              <div className="admin-filter-row" role="group" aria-label="Filter orders by status">
                {orderStatusOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={orderStatusFilter === status ? "active" : ""}
                    onClick={() => setOrderStatusFilter(status)}
                  >
                    {status === "all" ? "All" : formatClientOrderStatus(status)}
                  </button>
                ))}
              </div>

              <div className="admin-filter-row" role="group" aria-label="Orders directory actions">
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setOrdersRefreshKey((current) => current + 1)}
                  disabled={ordersLoading}
                >
                  <RefreshCw size={14} aria-hidden="true" /> {ordersLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {ordersLoading && (
                <div className="admin-action-notice" role="status" aria-live="polite">
                  <Loader2 size={16} />
                  Loading the orders directory from the server…
                </div>
              )}

              {!ordersLoading && ordersError && (
                <div className="admin-security-notice" role="alert">
                  <AlertTriangle size={17} />
                  <p><strong>Orders directory unavailable.</strong> {ordersError}</p>
                </div>
              )}

              {!ordersLoading && !ordersError && (filteredOrdersList.length ? (
                <div className="admin-activity-list">
                  {filteredOrdersList.map((order, index) => (
                    <div className="admin-activity-row" key={order.id || `${order.createdAt}-${index}`}>
                      <span><ShoppingBag size={15} /></span>
                      <div>
                        <strong>{order.serviceName || "Service order"}{order.projectName ? ` · ${order.projectName}` : ""}</strong>
                        <small>
                          {[
                            formatClientOrderStatus(order.status),
                            formatClientOrderPrice(order.price, order.currency),
                            formatClientOrderDate(order.createdAt),
                            order.id ? `ID ${order.id.slice(0, 8)}` : "No ID",
                          ].join(" · ")}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : orders.length ? (
                <EmptyState title="No matching orders">No order matches this search or status filter. Try a different term or filter.</EmptyState>
              ) : (
                <EmptyState title="No orders yet">No customer orders exist on the server yet.</EmptyState>
              ))}
            </section>
          )}

          {activeSection === "reviews" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="CUSTOMER REVIEWS" title="Reviews">
                Live customer reviews, read from the server for the owner and approved admins. Reviewer and moderator identities are private and are never shown. This view is read-only.
              </AdminPageHeading>

              <div className="admin-filter-row" role="group" aria-label="Filter reviews by status">
                {reviewStatusOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={reviewStatusFilter === status ? "active" : ""}
                    onClick={() => setReviewStatusFilter(status)}
                  >
                    {status === "all" ? "All" : formatReviewStatus(status)}
                  </button>
                ))}
              </div>

              <div className="admin-filter-row" role="group" aria-label="Reviews directory actions">
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setReviewsRefreshKey((current) => current + 1)}
                  disabled={reviewsLoading}
                >
                  <RefreshCw size={14} aria-hidden="true" /> {reviewsLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {reviewsLoading && (
                <div className="admin-action-notice" role="status" aria-live="polite">
                  <Loader2 size={16} />
                  Loading the reviews directory from the server…
                </div>
              )}

              {!reviewsLoading && reviewsError && (
                <div className="admin-security-notice" role="alert">
                  <AlertTriangle size={17} />
                  <p><strong>Reviews directory unavailable.</strong> {reviewsError}</p>
                </div>
              )}

              {!reviewsLoading && !reviewsError && (filteredReviewsList.length ? (
                <div className="admin-activity-list">
                  {filteredReviewsList.map((review, index) => (
                    <div className="admin-activity-row" key={review.id || `${review.createdAt}-${index}`}>
                      <span><Star size={15} /></span>
                      <div>
                        <strong>{review.serviceName || "Service review"}</strong>
                        <small>{review.body ? review.body : "No written feedback."}</small>
                        <small>
                          {[
                            formatReviewRating(review.rating),
                            formatReviewStatus(review.status),
                            formatClientOrderDate(review.createdAt),
                          ].join(" · ")}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : reviews.length ? (
                <EmptyState title="No matching reviews">No review matches this search or status filter. Try a different term or filter.</EmptyState>
              ) : (
                <EmptyState title="No reviews yet">No customer reviews exist on the server yet.</EmptyState>
              ))}
            </section>
          )}

          {activeSection === "reports" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="CUSTOMER REPORTS" title="Reports">
                Live customer reports, read from the server for the owner and approved admins. Reporter identity and personal information are private and are never shown. This view is read-only.
              </AdminPageHeading>

              <div className="admin-filter-row" role="group" aria-label="Filter reports by status">
                {reportStatusOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={reportStatusFilter === status ? "active" : ""}
                    onClick={() => setReportStatusFilter(status)}
                  >
                    {status === "all" ? "All" : formatReportStatus(status)}
                  </button>
                ))}
              </div>

              <div className="admin-filter-row" role="group" aria-label="Reports directory actions">
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setReportsRefreshKey((current) => current + 1)}
                  disabled={reportsLoading}
                >
                  <RefreshCw size={14} aria-hidden="true" /> {reportsLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {reportsLoading && (
                <div className="admin-action-notice" role="status" aria-live="polite">
                  <Loader2 size={16} />
                  Loading the reports directory from the server…
                </div>
              )}

              {!reportsLoading && reportsError && (
                <div className="admin-security-notice" role="alert">
                  <AlertTriangle size={17} />
                  <p><strong>Reports directory unavailable.</strong> {reportsError}</p>
                </div>
              )}

              {!reportsLoading && !reportsError && (filteredReportsList.length ? (
                <div className="admin-activity-list">
                  {filteredReportsList.map((report, index) => (
                    <div className="admin-activity-row" key={report.id || `${report.createdAt}-${index}`}>
                      <span><ClipboardList size={15} /></span>
                      <div>
                        <strong>
                          {`${formatReportTargetType(report.targetType)} · ${report.targetLabel || "Unnamed target"}`}
                        </strong>
                        <small>{`Category: ${formatReportCategory(report.category)}`}</small>
                        <small>{report.reason ? report.reason : "No reason provided."}</small>
                        <small>
                          {[
                            formatReportStatus(report.status),
                            formatClientOrderDate(report.createdAt),
                          ].join(" · ")}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : reports.length ? (
                <EmptyState title="No matching reports">No report matches this search or status filter. Try a different term or filter.</EmptyState>
              ) : (
                <EmptyState title="No reports yet">No customer reports exist on the server yet.</EmptyState>
              ))}
            </section>
          )}

          {activeSection === "categories" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="MARKETPLACE TAXONOMY" title="Categories">
                Live service categories stored on the server. Adding, editing and deleting here updates the customer-facing service editor. Inactive categories stay hidden from customers but remain visible here.
              </AdminPageHeading>

              <form className="admin-form" onSubmit={saveCategory}>
                <label>Category name<input required maxLength={maximumCategoryNameLength} value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label>Description<input maxLength={maximumCategoryDescriptionLength} value={categoryForm.description} onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional" /></label>
                <label>Icon name<input maxLength={maximumCategoryIconNameLength} value={categoryForm.iconName} onChange={(event) => setCategoryForm((current) => ({ ...current, iconName: event.target.value }))} placeholder="Optional, e.g. store" /></label>
                {categoryForm.id && (
                  <label className="admin-checkbox-field">
                    <input type="checkbox" checked={categoryForm.active} onChange={(event) => setCategoryForm((current) => ({ ...current, active: event.target.checked }))} />
                    <span>Visible to customers (active)</span>
                  </label>
                )}
                <div className="admin-form-actions">
                  <button className="admin-primary-button" type="submit" disabled={categorySaving}>
                    {categorySaving ? "Saving…" : categoryForm.id ? "Update category" : "Add category"}
                  </button>
                  {categoryForm.id && <button className="admin-secondary-button" type="button" onClick={resetCategoryForm}>Cancel edit</button>}
                </div>
                {categoryFormError && <span className="seller-field-error" role="alert">{categoryFormError}</span>}
              </form>

              <div className="admin-filter-row" role="group" aria-label="Filter categories by status">
                {categoryStatusOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={categoryStatusFilter === status ? "active" : ""}
                    onClick={() => setCategoryStatusFilter(status)}
                  >
                    {status === "all" ? "All" : formatStatus(status)}
                  </button>
                ))}
              </div>

              <div className="admin-filter-row" role="group" aria-label="Categories directory actions">
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setCategoriesRefreshKey((current) => current + 1)}
                  disabled={categoriesLoading}
                >
                  <RefreshCw size={14} aria-hidden="true" /> {categoriesLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {reassignSource && (
                <div className="admin-security-notice" role="alert">
                  <AlertTriangle size={17} />
                  <div>
                    <p>
                      <strong>“{reassignSource.name}” still has {reassignSource.serviceCount} service{reassignSource.serviceCount === 1 ? "" : "s"}.</strong> Choose another category to move them to, then the category will be deleted.
                    </p>
                    <div className="admin-form-actions">
                      <select value={reassignTargetId} onChange={(event) => setReassignTargetId(event.target.value)} aria-label="Destination category">
                        <option value="">Choose a destination category</option>
                        {categories.filter((category) => category.id !== reassignSource.id).map((category) => (
                          <option value={category.id} key={category.id}>{category.active ? category.name : `${category.name} (inactive)`}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="admin-primary-button"
                        onClick={reassignAndDelete}
                        disabled={!reassignTargetId || categoryBusyId === reassignSource.id}
                      >
                        {categoryBusyId === reassignSource.id ? "Moving…" : "Move services & delete"}
                      </button>
                      <button type="button" className="admin-secondary-button" onClick={() => { setReassignSource(null); setReassignTargetId(""); }}>Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {categoriesLoading && (
                <div className="admin-action-notice" role="status" aria-live="polite">
                  <Loader2 size={16} />
                  Loading the categories directory from the server…
                </div>
              )}

              {!categoriesLoading && categoriesError && (
                <div className="admin-security-notice" role="alert">
                  <AlertTriangle size={17} />
                  <p><strong>Categories directory unavailable.</strong> {categoriesError}</p>
                </div>
              )}

              {!categoriesLoading && !categoriesError && (filteredCategoriesList.length ? (
                <div className="admin-category-list">
                  {filteredCategoriesList.map((category) => (
                    <article className="admin-category-row" key={category.id}>
                      <span className="admin-category-icon"><FolderKanban size={16} /></span>
                      <div>
                        <strong>{category.name}</strong>
                        <small>{category.description || "No description"}{category.iconName ? ` · ${category.iconName}` : ""}</small>
                        <small>{[category.active ? "Active" : "Inactive", `${category.serviceCount} service${category.serviceCount === 1 ? "" : "s"}`].join(" · ")}</small>
                      </div>
                      <button type="button" onClick={() => editCategory(category)}>Edit</button>
                      <button type="button" className="danger" onClick={() => deleteCategory(category)} disabled={categoryBusyId === category.id} aria-label={`Delete ${category.name}`}><Trash2 size={14} /></button>
                    </article>
                  ))}
                </div>
              ) : categories.length ? (
                <EmptyState title="No matching categories">No category matches this search or status filter. Try a different term or filter.</EmptyState>
              ) : (
                <EmptyState title="No categories yet">Add the first service category using the form above.</EmptyState>
              ))}
            </section>
          )}

          {activeSection === "settings" && (
            <RequireOwner
              signInMessage={<>Platform Configuration is limited to the NexTech owner. Sign in with the owner account to continue.</>}
              errorNote="Owner access could not be confirmed, so Platform Configuration stays closed."
              deniedMessage={<>This account is not the NexTech owner, so Platform Configuration is not available.</>}
            >
              <section className="admin-panel">
                <AdminPageHeading eyebrow="PLATFORM CONFIGURATION" title="Platform settings">
                  Values in this form are a local preview only. Saving does not update the public website or persist after refresh.
                </AdminPageHeading>
                <form className="admin-form admin-settings-form" onSubmit={saveSettings}>
                  <label>Website name<input value={settings.name} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label>Website description<textarea rows="3" value={settings.description} onChange={(event) => setSettings((current) => ({ ...current, description: event.target.value }))} placeholder="Not connected to the public website" /></label>
                  <label>Contact email<input type="email" value={settings.contactEmail} onChange={(event) => setSettings((current) => ({ ...current, contactEmail: event.target.value }))} /></label>
                  <label>Support email<input type="email" value={settings.supportEmail} onChange={(event) => setSettings((current) => ({ ...current, supportEmail: event.target.value }))} /></label>
                  <div className="admin-form-actions"><button className="admin-primary-button" type="submit">Save preview settings</button></div>
                </form>
              </section>
            </RequireOwner>
          )}

          {activeSection === "activity" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="ADMIN ACTION HISTORY" title="Activity log">
                Actions are held in browser memory and disappear when this page is refreshed.
              </AdminPageHeading>
              {activity.length ? <div className="admin-activity-list">{activity.map((item) => <div className="admin-activity-row" key={item.id}><span><Activity size={15} /></span><div><strong>{item.description}</strong><small>{item.time} · Browser preview</small></div></div>)}</div> : <EmptyState title="No recorded actions">Settings changes made in this session will be listed here.</EmptyState>}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

export default AdminDashboard;
