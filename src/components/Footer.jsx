import { ArrowUpRight, Instagram, Linkedin, Mail } from "lucide-react";
import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-brand-block">
          <Link className="brand" to="/">
            <span className="brand-mark"><span /></span>
            <span>NexTech<span className="brand-period">.</span></span>
          </Link>
          <p>A marketplace connecting great website ideas with talented developers.</p>
          <div className="footer-socials">
            <a href="https://www.instagram.com/" aria-label="Instagram" target="_blank" rel="noreferrer"><Instagram size={16} /></a>
            <a href="https://www.linkedin.com/" aria-label="LinkedIn" target="_blank" rel="noreferrer"><Linkedin size={16} /></a>
          </div>
        </div>
        <div className="footer-links">
          <div>
            <h4>Discover</h4>
            <Link to="/services">Explore Services</Link>
            <Link to="/messages?role=customer">Messages demo</Link>
            <Link to="/services">Categories</Link>
            <Link to="/templates">Website Templates</Link>
            <Link to="/about">About NexTech</Link>
            <Link to="/studio-services">Studio Services</Link>
          </div>
          <div>
            <h4>Get help</h4>
            <Link to="/contact">Contact Us</Link>
            <Link to="/contact">Help Center</Link>
            <a href="mailto:hello@techstudio.pk"><Mail size={12} /> hello@techstudio.pk</a>
          </div>
          <div>
            <h4>Information</h4>
            <a href="mailto:hello@techstudio.pk?subject=Privacy%20policy%20request">Privacy Policy</a>
            <a href="mailto:hello@techstudio.pk?subject=Terms%20and%20conditions%20request">Terms and Conditions</a>
            <Link to="/seller">Become a Seller <ArrowUpRight size={12} /></Link>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} NexTech. Connecting ideas with developers.</span>
        <a href="mailto:hello@techstudio.pk">Have a project? <span>Let’s talk.</span></a>
      </div>
    </footer>
  );
}
