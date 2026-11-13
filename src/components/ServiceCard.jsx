import { useState } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, Code2 } from "lucide-react";

export default function ServiceCard({ service }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className={`service-card${expanded ? " service-card-expanded" : ""}`}>
      <div className="service-preview">
        <img src={service.image} alt={`Sample website preview for ${service.category.toLowerCase()}`} loading="lazy" />
        <span className="service-sample-badge">SAMPLE LISTING</span>
        <span className="service-category-badge">{service.category}</span>
        <div className="service-preview-overlay" aria-hidden="true">
          <span className="service-preview-brand"><Code2 size={13} /> {service.previewBrand}</span>
          <span className="service-preview-title">{service.previewHeadline}</span>
          <span className="service-preview-link">Discover more <ArrowRight size={12} /></span>
        </div>
      </div>
      <div className="service-card-content">
        <div className="sample-seller"><span className="seller-avatar">{service.sellerInitials}</span><span><small>Sample seller</small><strong>{service.seller}</strong></span></div>
        <h3>{service.title}</h3>
        <p>{service.description}</p>
        <div className="service-card-meta"><span>Starting at</span><strong>PKR {new Intl.NumberFormat("en-PK").format(service.price)}</strong></div>
        {expanded && <p className="service-expanded-note">This sample listing is for demonstration. Contact TechStudio to discuss a similar website project and get connected with a developer.</p>}
        <div className="service-card-actions">
          <button className="market-button market-button-outline service-view-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Hide Details" : "View Service"} <ChevronDown size={15} />
          </button>
          {expanded && <a className="service-contact-link" href={`mailto:hello@techstudio.pk?subject=${encodeURIComponent(`Website project inquiry: ${service.title}`)}`}>Contact TechStudio <ArrowUpRight size={14} /></a>}
        </div>
      </div>
    </article>
  );
}
