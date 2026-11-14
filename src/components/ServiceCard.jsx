import { useState } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, Code2 } from "lucide-react";
import { Link } from "react-router-dom";

export default function ServiceCard({ service }) {
  const [expanded, setExpanded] = useState(false);
  const isSellerService = Boolean(service.ownerUsername);

  return (
    <article className={`service-card${expanded ? " service-card-expanded" : ""}`}>
      <div className="service-preview">
        <img src={service.image} alt={`${isSellerService ? "Website preview" : "Sample website preview"} for ${service.category.toLowerCase()}`} loading="lazy" />
        <span className="service-sample-badge">{isSellerService ? "SELLER PREVIEW" : "SAMPLE LISTING"}</span>
        <span className="service-category-badge">{service.category}</span>
        <div className="service-preview-overlay" aria-hidden="true">
          <span className="service-preview-brand"><Code2 size={13} /> {service.previewBrand}</span>
          <span className="service-preview-title">{service.previewHeadline}</span>
          <span className="service-preview-link">Discover more <ArrowRight size={12} /></span>
        </div>
      </div>
      <div className="service-card-content">
        <div className="sample-seller"><span className="seller-avatar">{service.sellerInitials}</span><span><small>{isSellerService ? "Seller preview" : "Sample seller"}</small><strong>{service.seller}</strong></span></div>
        <h3>{service.title}</h3>
        <p>{service.description}</p>
        <div className="service-card-meta"><span>Starting at</span><strong>PKR {new Intl.NumberFormat("en-PK").format(service.price)}</strong></div>
        {expanded && !isSellerService && <p className="service-expanded-note">This sample listing is for demonstration. Contact NexTech to discuss a similar website project and get connected with a developer.</p>}
        <div className="service-card-actions">
          {isSellerService ? (
            <Link className="market-button market-button-outline service-view-button" to={`/services/${service.id}`}>View Service <ArrowRight size={15} /></Link>
          ) : (
            <>
              <button className="market-button market-button-outline service-view-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                {expanded ? "Hide Details" : "View Service"} <ChevronDown size={15} />
              </button>
              {expanded && <a className="service-contact-link" href={`mailto:hello@techstudio.pk?subject=${encodeURIComponent(`Website project inquiry: ${service.title}`)}`}>Contact NexTech <ArrowUpRight size={14} /></a>}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
