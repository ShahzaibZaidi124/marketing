import { ArrowUpRight, Instagram, Linkedin, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { useSiteSettings } from "../context/SiteSettingsContext.jsx";
import { brandNameWithoutTrailingPeriod } from "../lib/platformSettings.js";

export default function Footer() {
  const { settings } = useSiteSettings();
  // Every value already falls back to the shipped default, so the layout below is
  // identical to before when a setting is empty. The support address falls back to
  // the contact address so the "Get help" link is never blank.
  const brandName = brandNameWithoutTrailingPeriod(settings.websiteName);
  const description = settings.websiteDescription;
  const contactEmail = settings.contactEmail;
  const supportEmail = settings.supportEmail || contactEmail;

  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-brand-block">
          <Link className="brand" to="/">
            <span className="brand-mark"><span /></span>
            <span>{brandName}<span className="brand-period">.</span></span>
          </Link>
          <p>{description}</p>
          <div className="footer-socials">
            <a href="https://www.instagram.com/" aria-label="Instagram" target="_blank" rel="noreferrer"><Instagram size={16} /></a>
            <a href="https://www.linkedin.com/" aria-label="LinkedIn" target="_blank" rel="noreferrer"><Linkedin size={16} /></a>
          </div>
        </div>
        <div className="footer-links">
          <div>
            <h4>Discover</h4>
            <Link to="/services">Explore Services</Link>
            <Link to="/messages">Messages</Link>
            <Link to="/services">Categories</Link>
            <Link to="/templates">Website Templates</Link>
            <Link to="/about">About {brandName}</Link>
            <Link to="/studio-services">Studio Services</Link>
          </div>
          <div>
            <h4>Get help</h4>
            <Link to="/contact">Contact Us</Link>
            <Link to="/contact">Help Center</Link>
            <a href={`mailto:${supportEmail}`}><Mail size={12} /> {supportEmail}</a>
          </div>
          <div>
            <h4>Information</h4>
            <a href={`mailto:${contactEmail}?subject=Privacy%20policy%20request`}>Privacy Policy</a>
            <a href={`mailto:${contactEmail}?subject=Terms%20and%20conditions%20request`}>Terms and Conditions</a>
            <Link to="/seller">Become a Seller <ArrowUpRight size={12} /></Link>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} {brandName}. Connecting ideas with developers.</span>
        <a href={`mailto:${contactEmail}`}>Have a project? <span>Let’s talk.</span></a>
      </div>
    </footer>
  );
}
