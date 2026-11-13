import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  Menu,
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

const navigation = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "users", label: "Users", Icon: UserRound },
  { key: "sellers", label: "Sellers", Icon: Store },
  { key: "services", label: "Services", Icon: BriefcaseBusiness },
  { key: "orders", label: "Orders", Icon: ShoppingBag },
  { key: "reports", label: "Reports & reviews", Icon: ClipboardList },
  { key: "categories", label: "Categories", Icon: FolderKanban },
  { key: "settings", label: "Platform settings", Icon: Settings },
  { key: "activity", label: "Activity log", Icon: Activity },
];

const statusFilters = ["all", "pending", "published", "rejected", "removed", "draft"];

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
  const { allServices, sellerServices, saveSellerService } = useMarketplace();
  const activeSection = pathname.split("/")[2] || "overview";
  const activeItem = navigation.find((item) => item.key === activeSection) || navigation[0];
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [profileOpen, setProfileOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [categories, setCategories] = useState(() => serviceCategories.map((item) => ({
    ...item,
    description: "",
    icon: "",
  })));
  const [categoryForm, setCategoryForm] = useState({ id: "", name: "", description: "", icon: "" });
  const [settings, setSettings] = useState({
    name: "TechStudio",
    description: "",
    contactEmail: "",
    supportEmail: "",
  });
  const [activity, setActivity] = useState([]);

  const filteredServices = useMemo(() => sellerServices.filter((service) => {
    const matchesStatus = statusFilter === "all" || service.status === statusFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [service.title, service.seller, service.category, service.ownerUsername]
      .some((value) => String(value || "").toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  }), [sellerServices, statusFilter, search]);

  const publishedCount = sellerServices.filter((service) => service.status === "published").length;
  const pendingCount = sellerServices.filter((service) => service.status === "pending").length;

  const logAction = (description) => {
    setActivity((current) => [{
      id: `${Date.now()}-${Math.random()}`,
      description,
      time: new Date().toLocaleString(),
    }, ...current]);
  };

  const beginServiceAction = (service, status) => {
    setPendingAction({ service, status });
    setActionReason("");
    setActionError("");
  };

  const completeServiceAction = (event) => {
    event.preventDefault();
    const reason = actionReason.trim();
    if (!reason) {
      setActionError("Enter a reason before continuing.");
      return;
    }
    if (!window.confirm(`${pendingAction.status === "removed" ? "Remove" : "Reject"} “${pendingAction.service.title}” in this browser preview?`)) return;
    const { service, status } = pendingAction;
    const saved = saveSellerService({ ...service, status, adminReason: reason }, service.ownerUsername);
    if (!saved) {
      setActionError("The service could not be updated in the current preview.");
      return;
    }
    logAction(`${formatStatus(status)} service “${service.title}” · ${reason}`);
    setNotice(`Service marked ${status} in this browser preview only. This change is not saved to a server.`);
    setPendingAction(null);
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
    users: ["User management", "No account directory is connected. Customer and seller records cannot be listed or changed."],
    sellers: ["Seller management", "Seller profiles and application decisions are not available without an account and seller-application backend."],
    orders: ["Order management", "No order system is connected. Customer orders and payment details are not available."],
    reports: ["Reports & reviews", "No reporting or review moderation backend is connected. No reports or reviews are available."],
  };

  return (
    <main className="admin-shell">
      <aside className={`admin-sidebar${sidebarOpen ? " open" : ""}`}>
        <Link className="admin-brand" to="/" aria-label="TechStudio home">
          <span className="brand-mark"><span /></span>
          <span>techstudio<span className="brand-period">.</span></span>
        </Link>
        <div className="admin-side-label">WORKSPACE</div>
        <nav className="admin-navigation" aria-label="Admin dashboard navigation">
          {navigation.map(({ key, label, Icon }) => (
            <Link
              key={key}
              className={`admin-nav-link${activeSection === key ? " active" : ""}`}
              to={key === "overview" ? "/admin" : `/admin/${key}`}
              onClick={() => setSidebarOpen(false)}
              aria-current={activeSection === key ? "page" : undefined}
            >
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
              {key === "services" && pendingCount > 0 && <small>{pendingCount}</small>}
            </Link>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <Shield size={15} />
          <span>Preview only<br /><small>No admin authentication or API</small></span>
        </div>
      </aside>

      {sidebarOpen && <button className="admin-sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <div className="admin-content">
        <header className="admin-topbar">
          <button className="admin-menu-toggle" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open dashboard navigation">
            <Menu size={19} />
          </button>
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
          <div className="admin-topbar-actions">
            <button type="button" className="admin-icon-button" aria-label="Notifications unavailable in preview" title="Notifications are not connected">
              <Bell size={17} />
            </button>
            <div className="admin-profile-wrap">
              <button className="admin-profile-button" type="button" onClick={() => setProfileOpen((current) => !current)} aria-expanded={profileOpen}>
                <span className="admin-avatar">TS</span>
                <span className="admin-profile-copy"><strong>Admin preview</strong><small>Demo workspace</small></span>
                <ChevronDown size={14} />
              </button>
              {profileOpen && (
                <div className="admin-profile-menu">
                  <strong>Public preview</strong>
                  <p>This interface does not verify an admin identity.</p>
                  <Link to="/" onClick={() => setProfileOpen(false)}>Visit marketplace</Link>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="admin-main">
          <div className="admin-heading-row">
            <div>
              <span className="market-eyebrow">TECHSTUDIO · ADMIN WORKSPACE</span>
              <h1>{activeSection === "overview" ? "Platform overview" : activeItem.label}</h1>
              <p>Manage your marketplace preview and review platform activity.</p>
            </div>
            <div className="admin-status-chip"><span /> Demo mode</div>
          </div>

          <div className="admin-security-notice" role="note">
            <AlertTriangle size={17} />
            <p><strong>Not a secure admin system.</strong> No backend, database, sign-in, or server-side role checks are connected. This page is publicly accessible; preview changes are in browser memory only. Do not use it to manage real accounts or sensitive data.</p>
          </div>

          {notice && <div className="admin-action-notice" role="status"><CheckCircle2 size={16} />{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={14} /></button></div>}

          {activeSection === "overview" && (
            <>
              <div className="admin-stats-grid">
                <article className="admin-stat-card"><span><UserRound size={17} /></span><small>Total users</small><strong>Unavailable</strong><p>Account backend not connected</p></article>
                <article className="admin-stat-card"><span><Store size={17} /></span><small>Total sellers</small><strong>Unavailable</strong><p>Account backend not connected</p></article>
                <article className="admin-stat-card"><span><BriefcaseBusiness size={17} /></span><small>Published services</small><strong>{publishedCount}</strong><p>Seller-created services in this session</p></article>
                <article className="admin-stat-card"><span><ClipboardList size={17} /></span><small>Pending approvals</small><strong>{pendingCount || "Unavailable"}</strong><p>{pendingCount ? "Preview services awaiting review" : "Approval workflow not connected"}</p></article>
                <article className="admin-stat-card"><span><ShoppingBag size={17} /></span><small>Total orders</small><strong>Unavailable</strong><p>Order backend not connected</p></article>
                <article className="admin-stat-card"><span><AlertTriangle size={17} /></span><small>Open reports</small><strong>Unavailable</strong><p>Reports backend not connected</p></article>
              </div>
              <div className="admin-overview-grid">
                <section className="admin-panel">
                  <AdminPageHeading eyebrow="LATEST CHANGES" title="Recent activity" />
                  {activity.length ? (
                    <div className="admin-activity-list">{activity.slice(0, 5).map((item) => <div className="admin-activity-row" key={item.id}><span><Activity size={15} /></span><div><strong>{item.description}</strong><small>{item.time} · Browser preview</small></div></div>)}</div>
                  ) : <EmptyState title="No activity yet">Admin actions are not logged on a server. Preview actions will appear here until this page is refreshed.</EmptyState>}
                </section>
                <section className="admin-panel">
                  <AdminPageHeading eyebrow="ORDER ACTIVITY" title="Recent orders" />
                  <EmptyState title="Order data unavailable">There is no order backend connected, so real order records cannot be displayed.</EmptyState>
                </section>
              </div>
            </>
          )}

          {unavailableSections[activeSection] && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="DATA SOURCE UNAVAILABLE" title={unavailableSections[activeSection][0]} />
              <EmptyState title="No account data connected">{unavailableSections[activeSection][1]}</EmptyState>
            </section>
          )}

          {activeSection === "services" && (
            <section className="admin-panel">
              <AdminPageHeading eyebrow="SERVICE MODERATION" title="Services" >
                Only services created in the current browser session are shown. The existing seller workflow does not provide an approval queue.
              </AdminPageHeading>
              <div className="admin-filter-row" role="group" aria-label="Filter services by status">
                {statusFilters.map((status) => <button key={status} type="button" className={statusFilter === status ? "active" : ""} onClick={() => setStatusFilter(status)}>{status === "all" ? "All" : formatStatus(status)}</button>)}
              </div>
              {filteredServices.length ? (
                <div className="admin-service-list">
                  {filteredServices.map((service) => (
                    <article className="admin-service-row" key={service.id}>
                      {service.image && <img src={service.image} alt="" />}
                      <div className="admin-service-details">
                        <span>{service.category || "Uncategorized"} · Seller listing preview</span>
                        <h3>{service.title}</h3>
                        <p>{service.description}</p>
                        <small>PKR {new Intl.NumberFormat("en-PK").format(service.price || 0)} · {formatStatus(service.status)}</small>
                      </div>
                      <div className={`admin-status-pill ${service.status}`}>{formatStatus(service.status)}</div>
                      {(service.status === "published" || service.status === "pending") && (
                        <div className="admin-row-actions">
                          {service.status === "pending" && <button type="button" onClick={() => {
                            if (!window.confirm(`Approve “${service.title}” in this browser preview?`)) return;
                            if (!saveSellerService({ ...service, status: "published" }, service.ownerUsername)) {
                              setNotice("The service could not be updated in the current preview.");
                              return;
                            }
                            logAction(`Approved service “${service.title}”`);
                            setNotice("Service approved in this browser preview only; this change is not saved to a server.");
                          }}><Check size={14} /> Approve</button>}
                          <button type="button" className="danger" onClick={() => beginServiceAction(service, service.status === "pending" ? "rejected" : "removed")}><Trash2 size={14} /> {service.status === "pending" ? "Reject" : "Remove"}</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : <EmptyState title={search ? "No matching services" : "No services in this session"}>{search ? "Try a different search term or status filter." : "Create a service from the seller dashboard in this browser session to see it here. Sample marketplace listings are not admin-managed records."}</EmptyState>}
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

      {pendingAction && (
        <div className="admin-modal-backdrop" role="presentation">
          <form className="admin-confirm-modal" onSubmit={completeServiceAction} role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
            <button className="admin-modal-close" type="button" onClick={() => setPendingAction(null)} aria-label="Cancel action"><X size={17} /></button>
            <span className="admin-modal-icon"><AlertTriangle size={19} /></span>
            <h2 id="admin-confirm-title">{pendingAction.status === "removed" ? "Remove service?" : "Reject service?"}</h2>
            <p>This affects only the current browser preview. Enter a reason to continue.</p>
            <label htmlFor="admin-action-reason">Reason</label>
            <textarea id="admin-action-reason" value={actionReason} onChange={(event) => setActionReason(event.target.value)} rows="3" required autoFocus />
            {actionError && <p className="admin-form-error" role="alert">{actionError}</p>}
            <div className="admin-form-actions"><button className="admin-danger-button" type="submit">{pendingAction.status === "removed" ? "Remove service" : "Reject service"}</button><button className="admin-secondary-button" type="button" onClick={() => setPendingAction(null)}>Cancel</button></div>
          </form>
        </div>
      )}
    </main>
  );
}

export default AdminDashboard;
