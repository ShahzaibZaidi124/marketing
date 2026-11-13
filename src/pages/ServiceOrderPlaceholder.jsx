import { ArrowLeft, ArrowUpRight, CircleDashed, CreditCard } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { serviceListings, servicePackages } from "../data/services.js";

export default function ServiceOrderPlaceholder() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const service = serviceListings.find((item) => item.id === id);
  const packageOption = servicePackages.find((item) => item.id === searchParams.get("package"));

  if (!service) {
    return (
      <main className="service-detail-not-found">
        <span className="market-eyebrow">SERVICE NOT FOUND</span>
        <h1>This service isn’t available.</h1>
        <Link className="market-button market-button-primary" to="/services">Explore Services <ArrowUpRight size={15} /></Link>
      </main>
    );
  }

  return (
    <main className="market-section service-order-placeholder">
      <Link className="service-detail-back" to={`/services/${service.id}`}><ArrowLeft size={15} /> Back to service</Link>
      <section className="order-placeholder-card">
        <span className="order-placeholder-icon"><CircleDashed size={27} /></span>
        <span className="market-eyebrow">ORDER REQUIREMENTS · COMING SOON</span>
        <h1>Review your project details with the developer.</h1>
        <p className="order-placeholder-description">The marketplace order flow is not connected yet. This sample listing has not been ordered and no payment has been taken.</p>
        <div className="order-placeholder-summary">
          <div><span>Service</span><strong>{service.title}</strong></div>
          <div><span>Package</span><strong>{packageOption ? packageOption.name : "Choose a package on the service page"}</strong></div>
          {packageOption && <div><span>Sample price and delivery</span><strong>PKR {new Intl.NumberFormat("en-PK").format(packageOption.price)} · {packageOption.deliveryDays} days</strong></div>}
        </div>
        <p className="order-placeholder-notice"><CreditCard size={15} /> No checkout or payment functionality is available in this step.</p>
        <a className="market-button market-button-primary" href={`mailto:hello@techstudio.pk?subject=${encodeURIComponent(`Website project inquiry: ${service.title}`)}`}>Ask TechStudio about this service <ArrowUpRight size={15} /></a>
      </section>
    </main>
  );
}
