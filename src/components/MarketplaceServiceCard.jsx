import { Clock3 } from "lucide-react";
import { Link } from "react-router-dom";

export default function MarketplaceServiceCard({ service }) {
  return (
    <article className="browse-service-card">
      <Link className="browse-service-preview" to={`/services/${service.id}`} aria-label={`View ${service.title}`}>
        <img src={service.image} alt={`Sample website preview for ${service.category}`} loading="lazy" />
        <span className="browse-sample-badge">SAMPLE LISTING</span>
        <span className="browse-category-badge">{service.category}</span>
      </Link>
      <div className="browse-service-content">
        <div className="browse-seller">
          <img src={service.sellerImage} alt="" loading="lazy" />
          <span><small>Sample seller</small><strong>{service.seller}</strong></span>
        </div>
        <h2><Link to={`/services/${service.id}`}>{service.title}</Link></h2>
        <p>{service.description}</p>
        <div className="browse-service-meta">
          <span><Clock3 size={14} /> Delivery in {service.deliveryDays} days</span>
          <span>Starting at <strong>PKR {new Intl.NumberFormat("en-PK").format(service.price)}</strong></span>
        </div>
        <Link className="market-button market-button-primary browse-view-button" to={`/services/${service.id}`}>View Service</Link>
      </div>
    </article>
  );
}
