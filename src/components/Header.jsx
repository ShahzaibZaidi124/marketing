import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowUpRight, Menu, X } from "lucide-react";

const links = [
  { label: "Home", to: "/" },
  { label: "Explore Services", to: "/services" },
  { label: "Categories", to: "/#categories" },
  { label: "Become a Seller", to: "/#seller" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <div className="nav-shell">
        <Link className="brand" to="/" aria-label="TechStudio home" onClick={closeMenu}>
          <span className="brand-mark"><span /></span>
          <span>techstudio<span className="brand-period">.</span></span>
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
          <a className="nav-login" href="mailto:hello@techstudio.pk?subject=TechStudio%20account%20access" onClick={closeMenu}>Login</a>
          <Link className="market-button market-button-primary nav-signup" to="/#seller" onClick={closeMenu}>
            Sign Up <ArrowUpRight size={14} />
          </Link>
        </nav>
      </div>
    </header>
  );
}
