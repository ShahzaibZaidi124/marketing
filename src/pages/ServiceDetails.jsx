import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Code2,
  MonitorSmartphone,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { serviceDetailsByCategory, serviceListings, servicePackages } from "../data/services.js";

const frequentlyAskedQuestions = [
  {
    question: "What information does the developer need?",
    answer: "Share your website goals, preferred pages, content, brand assets and any reference sites you have. The exact requirements should be confirmed with the developer before an order begins.",
  },
  {
    question: "Is the website mobile responsive?",
    answer: "Responsive design is included in all three sample packages. Confirm the final supported layouts and browser requirements with the developer.",
  },
  {
    question: "Can I request changes?",
    answer: "Yes, discuss feedback and revisions with the developer. Revision scope and timing should be agreed before work starts; no revision count is promised in these sample listings.",
  },
  {
    question: "How long does delivery take?",
    answer: "The sample estimates are 3 days for Basic, 5 days for Standard and 7 days for Premium. Actual timing depends on the agreed scope and when project content is ready.",
  },
];

function ServiceGallery({ service, images, selectedImage, onSelectImage }) {
  return (
    <section className="service-gallery" aria-label="Service portfolio gallery">
      <div className="service-gallery-main">
        <img src={images[selectedImage].src} alt={images[selectedImage].alt} />
        <span className="browse-sample-badge">SAMPLE PREVIEW</span>
      </div>
      <div className="service-gallery-thumbnails" aria-label="Choose a preview image">
        {images.map((image, index) => (
          <button
            className={index === selectedImage ? "service-gallery-thumb active" : "service-gallery-thumb"}
            key={image.src}
            type="button"
            aria-label={`Show preview ${index + 1} for ${service.category}`}
            aria-pressed={index === selectedImage}
            onClick={() => onSelectImage(index)}
          >
            <img src={image.src} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </section>
  );
}

function PricingPackage({ packageOption, selected, onSelect }) {
  return (
    <label className={`service-package${selected ? " service-package-selected" : ""}`}>
      <input
        type="radio"
        name="service-package"
        value={packageOption.id}
        checked={selected}
        onChange={onSelect}
      />
      <span className="service-package-top">
        <span><strong>{packageOption.name}</strong><small>Sample price</small></span>
        <span className="service-package-radio" aria-hidden="true"><span /></span>
      </span>
      <span className="service-package-price">PKR {new Intl.NumberFormat("en-PK").format(packageOption.price)}</span>
      <span className="service-package-summary">{packageOption.summary}</span>
      <span className="service-package-divider" />
      <span className="service-package-delivery"><Clock3 size={15} /> {packageOption.deliveryDays}-day delivery</span>
      <span className="service-package-features">
        {packageOption.features.map((feature) => <span key={feature}><Check size={14} /> {feature}</span>)}
      </span>
      <span className="service-package-action">{selected ? "Selected package" : "Select package"}</span>
    </label>
  );
}

export default function ServiceDetails() {
  const { id } = useParams();
  const service = serviceListings.find((item) => item.id === id);
  const details = service ? serviceDetailsByCategory[service.categoryId] : undefined;
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedPackageId, setSelectedPackageId] = useState("basic");
  const selectedPackage = servicePackages.find((item) => item.id === selectedPackageId) || servicePackages[0];

  useEffect(() => {
    setSelectedImage(0);
    setSelectedPackageId("basic");
  }, [id]);

  if (!service) {
    return (
      <main className="service-detail-not-found">
        <span className="market-eyebrow">SERVICE NOT FOUND</span>
        <h1>This service isn’t available.</h1>
        <p>Browse the current sample listings to find a website service that fits your project.</p>
        <Link className="market-button market-button-primary" to="/services">Explore Services <ArrowUpRight size={15} /></Link>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="service-detail-not-found">
        <span className="market-eyebrow">SERVICE DETAILS UNAVAILABLE</span>
        <h1>Details for this service aren’t ready.</h1>
        <p>Return to Explore Services to browse available listings.</p>
        <Link className="market-button market-button-primary" to="/services">Explore Services <ArrowUpRight size={15} /></Link>
      </main>
    );
  }

  const galleryImages = [
    { src: service.image, alt: `Sample website preview for ${service.category}` },
    ...details.galleryImages.map((src, index) => ({
      src,
      alt: `Sample ${service.category.toLowerCase()} portfolio concept ${index + 1}`,
    })),
  ];

  return (
    <main className="market-section service-details-page">
      <nav className="service-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link><span aria-hidden="true">/</span>
        <Link to="/services">Explore Services</Link><span aria-hidden="true">/</span>
        <span aria-current="page">{service.category}</span>
      </nav>

      <header className="service-detail-heading">
        <span className="service-detail-category">{service.category}</span>
        <h1>{details.detailTitle}</h1>
        <div className="browse-seller service-detail-seller">
          <img src={service.sellerImage} alt="" />
          <span><small>Sample seller</small><strong>{service.seller}</strong></span>
        </div>
        <p className="service-detail-description">{service.description}</p>
        <span className="service-detail-sample-note">Sample listing · Seller level, reviews and ratings are not provided</span>
      </header>

      <ServiceGallery
        service={service}
        images={galleryImages}
        selectedImage={selectedImage}
        onSelectImage={setSelectedImage}
      />

      <section className="service-detail-section service-about-section">
        <div className="service-detail-section-heading"><span className="market-eyebrow">A closer look</span><h2>About this service</h2></div>
        <p className="service-about-copy">{details.about}</p>
        <div className="service-detail-lists">
          <div>
            <h3>What’s included</h3>
            <ul className="service-included-list">{details.features.map((feature) => <li key={feature}><Check size={15} /> {feature}</li>)}</ul>
          </div>
          <div>
            <h3>Technologies and approach</h3>
            <p className="service-responsive-note"><MonitorSmartphone size={17} /> Responsive design is included in each sample package.</p>
            <div className="service-tech-list">{details.technologies.map((technology) => <span key={technology}><Code2 size={13} /> {technology}</span>)}</div>
          </div>
        </div>
        <p className="service-detail-disclaimer">Sample listing details are for demonstration. Confirm requirements, scope and integrations with a developer before proceeding.</p>
      </section>

      <section className="service-detail-section seller-profile-section">
        <div className="service-detail-section-heading"><span className="market-eyebrow">The person behind the project</span><h2>Seller profile</h2></div>
        <div className="seller-profile-card">
          <div className="seller-profile-main">
            <img className="seller-profile-image" src={service.sellerImage} alt="" />
            <div className="seller-profile-copy">
              <span className="seller-profile-label">Sample seller profile</span>
              <h3>{service.seller}</h3>
              <p>{details.sellerBio}</p>
            </div>
            <a className="market-button market-button-outline seller-contact-button" href={`mailto:hello@techstudio.pk?subject=${encodeURIComponent(`Contact request for ${service.seller}`)}`}>
              Contact Seller <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="seller-profile-skills">
            <h4>Skills</h4>
            <div>{details.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
          </div>
          <p className="seller-contact-note">Sample profiles are illustrative. This contact link reaches TechStudio; direct seller messaging is not available yet.</p>
        </div>
        <div className="seller-portfolio-heading"><h3>Portfolio examples</h3><span>Sample concepts · Not client work</span></div>
        <div className="seller-portfolio-grid">
          {details.portfolio.map((example) => (
            <article className="seller-portfolio-card" key={example.title}>
              <img src={example.image} alt="" loading="lazy" />
              <div><span>Sample concept</span><h4>{example.title}</h4><p>{example.description}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="service-detail-section service-pricing-section" id="packages">
        <div className="service-detail-section-heading"><span className="market-eyebrow">Choose what fits your project</span><h2>Packages and pricing</h2><p>All prices shown are samples for demonstration.</p></div>
        <div className="service-package-grid">
          {servicePackages.map((packageOption) => (
            <PricingPackage
              key={packageOption.id}
              packageOption={packageOption}
              selected={selectedPackageId === packageOption.id}
              onSelect={() => setSelectedPackageId(packageOption.id)}
            />
          ))}
        </div>
        <div className="selected-package-summary">
          <span>Selected: <strong>{selectedPackage.name}</strong> · PKR {new Intl.NumberFormat("en-PK").format(selectedPackage.price)} · {selectedPackage.deliveryDays} days</span>
          <Link className="market-button market-button-primary" to={`/services/${service.id}/order?package=${selectedPackage.id}`}>Order Now <ArrowRight size={15} /></Link>
        </div>
      </section>

      <section className="service-detail-section service-faq-section">
        <div className="service-detail-section-heading"><span className="market-eyebrow">Good to know</span><h2>Frequently asked questions</h2></div>
        <div className="service-faq-list">
          {frequentlyAskedQuestions.map(({ question, answer }) => (
            <details className="service-faq-item" key={question}>
              <summary>{question}<span aria-hidden="true">+</span></summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
