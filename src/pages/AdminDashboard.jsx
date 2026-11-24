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
  Store,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { serviceCategories } from "../data/services.js";
import { useMarketplace } from "../context/MarketplaceContext.jsx";
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
  { key: "reports", label: "Reports & reviews", Icon: ClipboardList },
  { key: "categories", label: "Categories", Icon: FolderKanban },
  { key: "settings", label: "Platform settings", Icon: Settings },
  { key: "activity", label: "Activity log", Icon: Activity },
];

// The only status filter the live catalog supports: the real is_active column.
// Preview-only statuses (pending/published/rejected) are not database fields and
// are not offered here.
const serviceStatusOptions = ["all", "active", "inactive"];

// The only status filter the live orders directory supports: the real status
// column, whose allowed values are pending / active / completed / rejected.
const orderStatusOptions = ["all", "pending", "active", "completed", "rejected"];

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
  const { allServices } = useMarketplace();
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
  const [categories, setCategories] = useState(() => serviceCategories.map((item) => ({
    ...item,
    description: "",
    icon: "",
  })));
  const [categoryForm, setCategoryForm] = useState({ id: "", name: "", description: "", icon: "" });
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

  // The Messages link is owner-only and fails closed: it stays hidden for
  // guests, for customers, and while the server-side owner check is pending or
  // unavailable. The inbox itself keeps its RequireOwner gate.
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
    () => navigation.filter((item) => item.key !== "messages" || isOwner),
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

  // Overview, Users, Services and Orders are backed by live server data; the
  // remaining sections are still browser previews.
  const isPreviewSection = !isMessagesSection
    && activeSection !== "overview"
    && activeSection !== "users"
    && activeSection !== "services"
    && activeSection !== "orders";

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

  const saveCategory = (event) => {
    event.preventDefault();
    const name = categoryForm.name.trim();
    if (!name) return;
    if (categoryForm.id) {
      setCategories((current) => current.map((category) => category.id === categoryForm.id
        ? { ...category, name, description: categoryForm.description.trim(), icon: categoryForm.icon.trim() }
        : category));
      logAction(`Edited category “${name}”`);
    } else {
      const id = `preview-${Date.now().toString(36)}`;
      setCategories((current) => [...current, {
        id,
        name,
        description: categoryForm.description.trim(),
        icon: categoryForm.icon.trim(),
      }]);
      logAction(`Added category “${name}”`);
    }
    setCategoryForm({ id: "", name: "", description: "", icon: "" });
    setNotice("Category updated in this browser preview only; it is not saved to a server.");
  };

  const editCategory = (category) => {
    setCategoryForm({
      id: category.id,
      name: category.name,
      description: category.description,
      icon: category.icon,
    });
  };

  const deleteCategory = (category) => {
    const inUse = allServices.some((service) => service.categoryId === category.id);
    if (inUse) {
      setNotice(`“${category.name}” is in use by a service and cannot be deleted.`);
      return;
    }
    if (!window.confirm(`Delete “${category.name}” from this browser preview?`)) return;
    setCategories((current) => current.filter((item) => item.id !== category.id));
    logAction(`Deleted category “${category.name}”`);
    setNotice("Category deleted in this browser preview only; it is not saved to a server.");
  };

  const saveSettings = (event) => {
    event.preventDefault();
    setNotice("Settings updated in this browser preview only; they are not saved to a server.");
    logAction("Updated platform settings in preview");
  };

  const unavailableSections = {
    sellers: ["Seller management", "Seller profiles and application decisions are not available without an account and seller-application backend."],
    reports: ["Reports & reviews", "No reporting or review moderation backend is connected. No reports or reviews are available."],
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
                Live services, read from the server for the owner and approved admins. Services have no seller or category column in the database, so only the real catalog fields are shown. This view is read-only.
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

          {activeSection === "categories" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="MARKETPLACE TAXONOMY" title="Categories">
                Categories below are the existing marketplace options. Changes in this preview are temporary and do not update the service editor or server.
              </AdminPageHeading>
              <form className="admin-form" onSubmit={saveCategory}>
                <label>Category name<input required value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label>Description<input value={categoryForm.description} onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))} /></label>
                <label>Icon name<input value={categoryForm.icon} onChange={(event) => setCategoryForm((current) => ({ ...current, icon: event.target.value }))} placeholder="Optional" /></label>
                <div className="admin-form-actions"><button className="admin-primary-button" type="submit">{categoryForm.id ? "Update category" : "Add category"}</button>{categoryForm.id && <button className="admin-secondary-button" type="button" onClick={() => setCategoryForm({ id: "", name: "", description: "", icon: "" })}>Cancel edit</button>}</div>
              </form>
              {categories.filter((category) => !search.trim() || category.name.toLowerCase().includes(search.trim().toLowerCase())).length ? (
                <div className="admin-category-list">
                  {categories.filter((category) => !search.trim() || category.name.toLowerCase().includes(search.trim().toLowerCase())).map((category) => (
                    <article className="admin-category-row" key={category.id}>
                      <span className="admin-category-icon"><FolderKanban size={16} /></span>
                      <div><strong>{category.name}</strong><small>{category.description || "No description"}{category.icon ? ` · ${category.icon}` : ""}</small></div>
                      <button type="button" onClick={() => editCategory(category)}>Edit</button>
                      <button type="button" className="danger" onClick={() => deleteCategory(category)} aria-label={`Delete ${category.name}`}><Trash2 size={14} /></button>
                    </article>
                  ))}
                </div>
              ) : <EmptyState title="No matching categories">Try another search.</EmptyState>}
            </section>
          )}

          {activeSection === "settings" && (
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
          )}

          {activeSection === "activity" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="ADMIN ACTION HISTORY" title="Activity log">
                Actions are held in browser memory and disappear when this page is refreshed.
              </AdminPageHeading>
              {activity.length ? <div className="admin-activity-list">{activity.map((item) => <div className="admin-activity-row" key={item.id}><span><Activity size={15} /></span><div><strong>{item.description}</strong><small>{item.time} · Browser preview</small></div></div>)}</div> : <EmptyState title="No recorded actions">Service and category preview changes will be listed here during this session.</EmptyState>}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

export default AdminDashboard;
