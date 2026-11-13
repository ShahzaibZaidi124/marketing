import { ArrowUpRight, Eye, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { formatPrice } from "../data/templates.js";

export default function TemplateCard({ template }) {
  return (
    <article className="template-card">
      <Link
        className={`template-art template-art-${template.style}`}
        to={`/templates/${template.id}`}
        aria-label={`View ${template.name} details`}
      >
        {template.tag && <span className="template-tag">{template.tag}</span>}
        <div className="mini-site">
          <div className="mini-nav">
            <span className="mini-brand"><i /> {template.name.split(" ")[0].toLowerCase()}</span>
            <span className="mini-nav-links">Work &nbsp;&nbsp; About &nbsp;&nbsp; Contact</span>
            <span className="mini-nav-dot">↗</span>
          </div>
          <div className="mini-content">
            <span className="mini-overline">A little different, by design</span>
            <span className="mini-headline">{miniHeading[template.style]}</span>
            <span className="mini-description">Make room for what comes next.</span>
            <span className="mini-action">See what’s possible <ArrowUpRight size={10} /></span>
          </div>
          <div className="mini-decoration" aria-hidden="true">
            <div className="mini-glass"><span /><i /><i /><i /></div>
            <span className="mini-orbit mini-orbit-one" />
            <span className="mini-orbit mini-orbit-two" />
          </div>
          <div className="mini-foot"><span>01 — 06</span><span>EST. FOR WHAT’S NEXT</span></div>
        </div>
        <span className="preview-hover"><Eye size={14} /> Preview template</span>
      </Link>
      <div className="template-card-info">
        <div>
          <span className="template-category">{template.category}</span>
          <h3><Link to={`/templates/${template.id}`}>{template.name}</Link></h3>
        </div>
        <span className="template-price">{formatPrice(template.price)}</span>
      </div>
      <p className="template-description">{template.description}</p>
      <div className="template-card-bottom">
        <span className="rating" aria-label={`Sample rating ${template.rating} from ${template.reviews} sample reviews`}><Star size={13} fill="currentColor" /> {template.rating} <span>({template.reviews} sample)</span></span>
        <Link className="card-link" to={`/templates/${template.id}`}>Take a closer look <ArrowUpRight size={13} /></Link>
      </div>
    </article>
  );
}

const miniHeading = {
  nimbus: "Make the\nfuture useful.",
  layer: "Work flows\nbetter here.",
  forma: "Everyday,\nreconsidered.",
  monogram: "An archive\nof good ideas.",
  orbit: "Good ideas\nmove people.",
  synth: "A clearer way\nto build.",
};
