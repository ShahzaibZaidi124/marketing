import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

function NavigationItem({ item, activeSection, onSelect }) {
  const className = `dashboard-nav-item${item.key === activeSection ? " active" : ""}`;
  const content = (
    <>
      <item.Icon size={17} aria-hidden="true" />
      <span>{item.label}</span>
      {item.badge && <small>{item.badge}</small>}
    </>
  );

  if (item.to) {
    return (
      <Link
        className={className}
        to={item.to}
        state={item.state}
        aria-current={item.key === activeSection ? "page" : undefined}
      >
        {content}
        {item.external && <ArrowUpRight size={13} aria-hidden="true" />}
      </Link>
    );
  }

  if (item.key === "logout") {
    return (
      <button className={className} type="button" onClick={item.onClick}>
        {content}
      </button>
    );
  }

  return (
    <button
      className={className}
      type="button"
      aria-current={item.key === activeSection ? "page" : undefined}
      onClick={() => onSelect(item.key)}
    >
      {content}
    </button>
  );
}

export default function DashboardLayout({
  role,
  displayName,
  avatar,
  activeSection,
  navigation,
  onSelect,
  children,
}) {
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();

  return (
    <main className="market-section dashboard-page">
      <header className="dashboard-page-heading">
        <div>
          <span className="market-eyebrow">{role} WORKSPACE · DEMO</span>
          <h1>{activeSection === "overview" ? `Welcome, ${displayName}.` : navigation.find((item) => item.key === activeSection)?.label || "Dashboard"}</h1>
          <p>Manage your TechStudio activity in this browser preview.</p>
        </div>
        <div className="dashboard-heading-profile">
          {avatar ? <img src={avatar} alt="" /> : <span aria-hidden="true">{initials || "TS"}</span>}
          <div><strong>{displayName}</strong><small>{role} demo</small></div>
        </div>
      </header>

      <div className="dashboard-demo-banner" role="note">
        <strong>Demo mode</strong>
        <span>There is no sign-in, order, review, payment, or dashboard API connected. Changes here stay in this browser session and are not private or server-saved.</span>
      </div>

      <div className="dashboard-layout">
        <aside className="dashboard-sidebar" aria-label={`${role} dashboard navigation`}>
          <div className="dashboard-sidebar-profile">
            {avatar ? <img src={avatar} alt="" /> : <span aria-hidden="true">{initials || "TS"}</span>}
            <div><strong>{displayName}</strong><small>{role} preview</small></div>
          </div>
          <nav className="dashboard-nav">
            {navigation.map((item) => (
              <NavigationItem key={item.key} item={item} activeSection={activeSection} onSelect={onSelect} />
            ))}
          </nav>
          <p className="dashboard-sidebar-note">No account is signed in. Logout returns to the public site.</p>
        </aside>
        <section className="dashboard-main" aria-live="polite">
          {children}
        </section>
      </div>
    </main>
  );
}
