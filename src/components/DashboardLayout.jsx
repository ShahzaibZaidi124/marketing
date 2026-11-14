import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

function NavigationItem({ item, activeSection, onSelect, onLogout, signingOut }) {
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
      <button className={className} type="button" onClick={onLogout} disabled={signingOut} aria-busy={signingOut}>
        <item.Icon size={17} aria-hidden="true" />
        <span>{signingOut ? "Signing out…" : item.label}</span>
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
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOut();
      navigate("/", { replace: true });
    } catch (authError) {
      setSignOutError(authError instanceof Error
        ? authError.message
        : "Could not sign out. Please try again.");
      setSigningOut(false);
    }
  };

  return (
    <main className="market-section dashboard-page">
      <header className="dashboard-page-heading">
        <div>
          <span className="market-eyebrow">{role} WORKSPACE · PREVIEW</span>
          <h1>{activeSection === "overview" ? `Welcome, ${displayName}.` : navigation.find((item) => item.key === activeSection)?.label || "Dashboard"}</h1>
          <p>{user ? "Your NexTech account is signed in; marketplace activity here is a preview." : "This dashboard is a local preview. Sign in to use your Supabase account."}</p>
        </div>
        <div className="dashboard-heading-profile">
          {avatar ? <img src={avatar} alt="" /> : <span aria-hidden="true">{initials || "TS"}</span>}
          <div><strong>{displayName}</strong><small>{role} {user ? "account" : "preview"}</small></div>
        </div>
      </header>

      <div className="dashboard-demo-banner" role="note">
        <strong>{user ? "Supabase account active" : "Marketplace preview"}</strong>
        <span>{user ? "Your login is managed by Supabase. Orders, reviews, payments, listings, and dashboard activity are not connected to a backend." : "This preview does not save account activity. Orders, reviews, payments, and dashboard activity are not connected to a backend."}</span>
      </div>

      <div className="dashboard-layout">
        <aside className="dashboard-sidebar" aria-label={`${role} dashboard navigation`}>
          <div className="dashboard-sidebar-profile">
            {avatar ? <img src={avatar} alt="" /> : <span aria-hidden="true">{initials || "TS"}</span>}
            <div><strong>{displayName}</strong><small>{role} {user ? "account" : "preview"}</small></div>
          </div>
          <nav className="dashboard-nav">
            {navigation.map((item) => (
              <NavigationItem
                key={item.key}
                item={item}
                activeSection={activeSection}
                onSelect={onSelect}
                onLogout={handleLogout}
                signingOut={signingOut}
              />
            ))}
          </nav>
          {signOutError && <p className="dashboard-signout-error" role="alert">{signOutError}</p>}
          <p className="dashboard-sidebar-note">{user ? `Signed in as ${user.email || displayName}. Log out to end your Supabase session.` : "No Supabase session is active."}</p>
        </aside>
        <section className="dashboard-main" aria-live="polite">
          {children}
        </section>
      </div>
    </main>
  );
}
