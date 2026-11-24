import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { signInWithGoogle } from "../lib/auth.js";

const links = [
  { label: "Home", to: "/" },
  { label: "Explore Services", to: "/services" },
  { label: "Messages", to: "/messages" },
  { label: "Dashboard", to: "/customer/dashboard" },
  { label: "Admin", to: "/admin-access" },
  { label: "Categories", to: "/#categories" },
  { label: "Become a Seller", to: "/seller" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState("");
  const { user, loading, signOut, profilePictureUrl } = useAuth();

  const closeMenu = () => setMenuOpen(false);
  const handleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    setSignInError("");
    closeMenu();
    try {
      await signInWithGoogle();
    } catch (authError) {
      setSignInError(authError instanceof Error
        ? authError.message
        : "Google sign-in could not be started. Please try again.");
      setSigningIn(false);
    }
  };
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOut();
      closeMenu();
    } catch (authError) {
      setSignOutError(authError instanceof Error
        ? authError.message
        : "Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };
  const accountLabel = user?.user_metadata?.full_name
    || user?.user_metadata?.name
    || user?.email
    || "Signed in";
  const accountInitials = accountLabel.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();

  return (
    <header className="site-header">
      <div className="nav-shell">
        <Link className="brand" to="/" aria-label="NexTech home" onClick={closeMenu}>
          <span className="brand-mark"><span /></span>
          <span>NexTech<span className="brand-period">.</span></span>
        </Link>
        <button
          className="menu-toggle"
          type="button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={`main-nav${menuOpen ? " main-nav-open" : ""}`} aria-label="Main navigation">
          {links.map(({ label, to }) => (
            <NavLink
              key={label}
              to={to}
              end={to === "/"}
              onClick={closeMenu}
              className={({ isActive }) => `nav-link${to === "/" && isActive ? " nav-link-active" : ""}`}
            >
              {label}
            </NavLink>
          ))}
          {loading ? (
            <span className="nav-auth-loading" role="status">Checking session…</span>
          ) : user ? (
            <>
              <span className="nav-account" title={accountLabel} aria-label={`Signed in as ${accountLabel}`}>
                {profilePictureUrl
                  ? <img className="nav-account-avatar" src={profilePictureUrl} alt="" />
                  : <span className="nav-account-avatar nav-account-avatar-fallback" aria-hidden="true">{accountInitials || "U"}</span>}
                <span className="nav-account-name">{accountLabel}</span>
              </span>
              <button
                className="nav-login nav-logout"
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                aria-busy={signingOut}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
              {signOutError && <span className="nav-auth-error" role="alert">{signOutError}</span>}
            </>
          ) : (
            <>
              <button
                className="nav-login"
                type="button"
                onClick={handleSignIn}
                disabled={signingIn}
                aria-busy={signingIn}
              >
                {signingIn ? "Connecting…" : "Login"}
              </button>
              {signInError && <span className="nav-auth-error" role="alert">{signInError}</span>}
              <Link className="market-button market-button-primary nav-signup" to="/seller/register" onClick={closeMenu}>
                Sign Up <ArrowUpRight size={14} />
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
