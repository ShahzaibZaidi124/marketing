import { ArrowLeft, ArrowUpRight, Check, Clock3, Monitor, ShieldCheck, Sparkles, Star } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { formatPrice, templates } from "../data/templates.js";

export function TemplateDetail() {
  const { id } = useParams();
  const template = templates.find((item) => item.id === id);

  if (!template) return <NotFound />;

  return (
    <main className="detail-page">
      <section className="detail-hero section">
        <Link to="/templates" className="back-link"><ArrowLeft size={14} /> Back to the collection</Link>
        <div className="detail-layout">
          <div className="detail-copy">
            <span className="eyebrow">{template.category} · MADE WITH INTENTION</span>
            <h1>{template.name}<span className="detail-period">.</span></h1>
            <p className="detail-description">{template.description} A thoughtful starting point, ready for your next big idea.</p>
            <div className="detail-rating"><span><Star size={14} fill="currentColor" /> {template.rating}</span> <span>·</span> <span>{template.reviews} thoughtful reviews</span></div>
            <div className="detail-price">{formatPrice(template.price)} <span>one-time payment</span></div>
            <div className="detail-actions"><Link className="button button-primary" to={`/order/${template.id}`}>Buy now <ArrowUpRight size={15} /></Link><Link className="button button-outline" to={`/demo/${template.id}`}>Live demo <Monitor size={15} /></Link></div>
            <div className="detail-assurance"><span><ShieldCheck size={14} /> Yours to make your own</span><span><Clock3 size={14} /> Made for a quicker launch</span></div>
          </div>
          <div className={`detail-art template-art-${template.style}`}>
            <div className="mini-site mini-site-large">
              <div className="mini-nav"><span className="mini-brand"><i /> {template.name.split(" ")[0].toLowerCase()}</span><span className="mini-nav-links">Work &nbsp;&nbsp;&nbsp; About &nbsp;&nbsp;&nbsp; Contact</span><span className="mini-nav-dot">↗</span></div>
              <div className="mini-content"><span className="mini-overline">A little different, by design</span><span className="mini-headline">{previewHeadings[template.style]}</span><span className="mini-description">Make room for what comes next.</span><span className="mini-action">See what’s possible <ArrowUpRight size={11} /></span></div>
              <div className="mini-decoration"><div className="mini-glass"><span /><i /><i /><i /></div><span className="mini-orbit mini-orbit-one" /><span className="mini-orbit mini-orbit-two" /></div>
              <div className="mini-foot"><span>01 — {String(template.pages).padStart(2, "0")}</span><span>EST. FOR WHAT’S NEXT</span></div>
            </div>
          </div>
        </div>
      </section>
      <section className="detail-includes section">
        <div className="detail-includes-copy"><span className="eyebrow">A little more of the good stuff</span><h2>A good foundation.<br /><span className="muted-heading">A whole lot of possibility.</span></h2><p>Everything you need to bring your idea to life, with the considered details already taken care of.</p></div>
        <div className="includes-card"><div className="includes-card-top"><Sparkles size={16} /><span>WHAT’S INCLUDED</span></div><div className="includes-pages">{template.features.map((feature) => <div key={feature}><span><Check size={13} /></span>{feature}</div>)}</div><div className="includes-footer"><span>{template.pages} thoughtfully designed pages</span><span>MADE WITH YOU IN MIND.</span></div></div>
      </section>
      <section className="detail-bottom-cta"><span className="eyebrow">A good idea is worth a good start</span><h2>Ready to make it yours?</h2><Link className="button button-primary" to={`/order/${template.id}`}>Get {template.name} <ArrowUpRight size={15} /></Link></section>
    </main>
  );
}

export function NotFound() {
  return <main className="simple-page"><span className="eyebrow">A LITTLE OFF THE MAP</span><h1>Looks like this page took a detour.</h1><p>The page you’re looking for isn’t here, but there’s a good place to begin.</p><Link className="button button-primary" to="/templates">Explore templates <ArrowUpRight size={15} /></Link></main>;
}

const previewHeadings = {
  nimbus: "Make the future useful.",
  layer: "Work flows better here.",
  forma: "Everyday, reconsidered.",
  monogram: "An archive of good ideas.",
  orbit: "Good ideas move people.",
  synth: "A clearer way to build.",
};
