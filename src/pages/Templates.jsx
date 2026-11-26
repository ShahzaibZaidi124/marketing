import { ArrowDown } from "lucide-react";
import TemplateGrid from "../components/TemplateGrid.jsx";

export default function Templates() {
  return (
    <main>
      <section className="page-hero templates-hero">
        <div className="section-topline"><span>THE NEXTECH MARKETPLACE</span><span>MADE WITH INTENTION, IN PAKISTAN</span></div>
        <div className="page-hero-content">
          <span className="eyebrow">A considered collection</span>
          <h1>Less blank canvas.<br /><span className="gradient-text">More brilliant ideas.</span></h1>
          <p>Beautifully made website templates for your next big thing.<br className="desktop-break" /> Sample prices only; purchases and payments aren’t enabled in this demo.</p>
          <a className="text-link" href="#all-templates">Find your starting point <ArrowDown size={14} /></a>
        </div>
        <div className="page-hero-bottom"><span>GOOD DESIGN STARTS RIGHT HERE</span><span>01 / 06 — THE COLLECTION</span></div>
      </section>
      <section className="section marketplace-section" id="all-templates">
        <div className="section-heading-row compact-heading"><div><span className="eyebrow">A good place to start</span><h2>Made for what’s next.</h2></div><p>Every template includes responsive layouts, thoughtfully considered details and room to make it yours.</p></div>
        <TemplateGrid />
      </section>
    </main>
  );
}
