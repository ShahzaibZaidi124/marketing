import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  Code2,
  LayoutTemplate,
  Search,
  ShoppingBag,
  Utensils,
  WandSparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import ServiceCard from "../components/ServiceCard.jsx";
import { serviceListings } from "../data/services.js";
import { useMarketplace } from "../context/MarketplaceContext.jsx";

const categories = [
  { id: "business-websites", name: "Business Websites", detail: "For growing businesses", Icon: BriefcaseBusiness },
  { id: "ecommerce-websites", name: "E-commerce Websites", detail: "Online stores that sell", Icon: ShoppingBag },
  { id: "portfolio-websites", name: "Portfolio Websites", detail: "Put your work in focus", Icon: LayoutTemplate },
  { id: "restaurant-websites", name: "Restaurant Websites", detail: "Menus, bookings and more", Icon: Utensils },
  { id: "landing-pages", name: "Landing Pages", detail: "Focused pages that convert", Icon: WandSparkles },
  { id: "wordpress-development", name: "WordPress Development", detail: "Flexible, easy to manage", Icon: Code2 },
  { id: "blog-websites", name: "Blog Websites", detail: "Share stories and ideas", Icon: BookOpen },
  { id: "custom-react-websites", name: "Custom React Websites", detail: "Custom-built React experiences", Icon: Code2 },
];

const popularSearches = ["Business Website", "E-commerce", "Portfolio", "WordPress"];

const steps = [
  { number: "01", title: "Explore services", description: "Search by website type and find a service that fits your project.", Icon: Search },
  { number: "02", title: "Choose a developer", description: "Compare sample listings and find the right skills for your idea.", Icon: Code2 },
  { number: "03", title: "Place an order", description: "Reach out to discuss the scope, timing and next steps for your website.", Icon: BriefcaseBusiness },
];

export default function Home() {
  const { allServices, publishedServices } = useMarketplace();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const filteredServices = useMemo(() => {
    const searchTerm = submittedQuery.trim().toLowerCase();
    const availableServices = searchTerm
      ? allServices
      : [...publishedServices, ...serviceListings].slice(0, 4);
    if (!searchTerm) return availableServices;
    return availableServices.filter((service) =>
      `${service.title} ${service.category} ${service.description} ${service.tags.join(" ")}`
        .toLowerCase()
        .includes(searchTerm),
    );
  }, [allServices, publishedServices, submittedQuery]);

  function searchServices(event) {
    event.preventDefault();
    setSubmittedQuery(query);
    document.getElementById("services")?.scrollIntoView({ behavior: "smooth" });
  }

  function searchFor(term) {
    setQuery(term);
    setSubmittedQuery(term);
    document.getElementById("services")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <main className="market-home">
      <section className="market-hero">
        <div className="market-hero-inner">
          <div className="market-hero-copy">
            <span className="market-eyebrow"><span className="market-eyebrow-dot" /> THE WEBSITE DEVELOPMENT MARKETPLACE</span>
            <h1>Find the Perfect<br /><span>Website Developer</span></h1>
            <p>Discover talented developers to build your dream website. Compare services, explore portfolios and hire the right developer.</p>
            <form className="service-search" onSubmit={searchServices} role="search">
              <Search size={19} aria-hidden="true" />
              <input
                aria-label="Search website development services"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for website services..."
              />
              <button className="market-button market-button-primary" type="submit">Search <ArrowRight size={16} /></button>
            </form>
            <div className="popular-searches">
              <span>Popular:</span>
              {popularSearches.map((item) => (
                <button key={item} type="button" onClick={() => searchFor(item)}>{item}</button>
              ))}
            </div>
            <a className="market-scroll-link" href="#categories">Explore categories <ArrowDown size={15} /></a>
          </div>
          <div className="market-hero-art" aria-label="A preview of website developer services">
            <div className="hero-preview hero-preview-back">
              <img src="https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=720&q=85" alt="" />
              <span>BUSINESS WEBSITE</span>
            </div>
            <div className="hero-preview hero-preview-main">
              <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=85" alt="Website analytics displayed on a laptop" />
              <div className="hero-preview-caption"><span className="hero-preview-mark"><Code2 size={16} /></span><span><strong>Made for your next big idea</strong><small>Find a developer who gets it.</small></span><ArrowUpRight size={16} /></div>
            </div>
            <span className="hero-art-caption">DESIGN · DEVELOPMENT · YOUR VISION</span>
          </div>
        </div>
        <div className="market-hero-bottom"><span>FIND THE RIGHT SKILLS FOR YOUR NEXT WEBSITE</span><span>LAHORE · EVERYWHERE</span></div>
      </section>

      <section className="market-section categories-section" id="categories">
        <div className="market-section-heading">
          <div><span className="market-eyebrow">Browse by what you need</span><h2>Popular categories</h2></div>
          <p>From a new business site to a full online store, find developers with the right focus for your project.</p>
        </div>
        <div className="category-cards">
          {categories.map(({ id, name, detail, Icon }, index) => (
            <Link className="category-card" key={id} to={`/services?category=${id}`}>
              <span className={`category-icon category-icon-${index + 1}`}><Icon size={21} strokeWidth={1.8} /></span>
              <span className="category-card-copy"><strong>{name}</strong><small>{detail}</small></span>
              <ArrowUpRight className="category-arrow" size={17} />
            </Link>
          ))}
        </div>
      </section>

      <section className="market-section featured-section" id="services">
        <div className="featured-heading">
          <div><span className="market-eyebrow">Find your development partner</span><h2>Featured services</h2></div>
          <span className="sample-listing-note">Sample listings for demonstration</span>
        </div>
        {submittedQuery && (
          <div className="search-results-note" aria-live="polite">
            <span>Showing results for <strong>“{submittedQuery}”</strong></span>
            <button type="button" onClick={() => { setQuery(""); setSubmittedQuery(""); }}>Clear search</button>
          </div>
        )}
        {filteredServices.length > 0 ? (
          <div className="service-cards">
            {filteredServices.map((service) => <ServiceCard key={service.id} service={service} />)}
          </div>
        ) : (
          <div className="service-empty-state">
            <span className="category-icon"><Search size={21} /></span>
            <h3>No matching sample services</h3>
            <p>Try a broader search, or browse all featured services.</p>
            <button className="market-button market-button-outline" type="button" onClick={() => { setQuery(""); setSubmittedQuery(""); }}>Show all services</button>
          </div>
        )}
        <div className="centered-link"><Link className="market-button market-button-outline" to="/services">Explore all services <ArrowRight size={15} /></Link></div>
      </section>

      <section className="seller-banner" id="seller">
        <div className="seller-banner-copy">
          <span className="market-eyebrow">For developers with a point of view</span>
          <h2>Turn Your Skills Into Opportunities</h2>
          <p>Join NexTech and start offering your website development services.</p>
          <Link className="market-button market-button-light" to="/seller">Become a Seller <ArrowUpRight size={16} /></Link>
        </div>
        <div className="seller-banner-art" aria-hidden="true">
          <span className="seller-code-line"><i /> const goodIdeas = buildTogether();</span>
          <span className="seller-code-line"><i /> ship(goodIdeas);</span>
          <span className="seller-code-cursor" />
          <Code2 size={54} strokeWidth={1.1} />
        </div>
      </section>

      <section className="market-section how-section" id="how-it-works">
        <div className="how-heading"><span className="market-eyebrow">Simple from first search to first hello</span><h2>How NexTech works</h2><p>A better way to find the people who can bring your website idea to life.</p></div>
        <div className="how-steps">
          {steps.map(({ number, title, description, Icon }, index) => (
            <article className="how-step" key={number}>
              <div className="how-step-top"><span className="how-step-icon"><Icon size={21} /></span><span className="how-step-number">{number}</span></div>
              <h3>{title}</h3>
              <p>{description}</p>
              {index < steps.length - 1 && <span className="how-step-connector" aria-hidden="true"><ArrowRight size={16} /></span>}
            </article>
          ))}
        </div>
        <div className="how-cta"><Link to="/contact" className="market-text-link">Have a question? Talk to us <ArrowRight size={15} /></Link></div>
      </section>
    </main>
  );
}
