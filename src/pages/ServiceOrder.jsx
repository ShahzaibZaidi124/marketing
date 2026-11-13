import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  FileText,
  Paperclip,
  ShoppingBag,
  UserRound,
  X,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { servicePackages } from "../data/services.js";
import { useMarketplace } from "../context/MarketplaceContext.jsx";

const websiteTypes = ["Business", "E-commerce", "Portfolio", "Restaurant", "Blog", "Other"];
const requiredFeatures = [
  "Contact form",
  "Online store",
  "Payment integration",
  "Blog",
  "Image gallery",
  "User login",
  "Other",
];
const allowedFileExtensions = [".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp"];
const maxFileSize = 10 * 1024 * 1024;
const currency = new Intl.NumberFormat("en-PK");

function FieldError({ id, children }) {
  return children ? <span className="service-order-error" id={id}>{children}</span> : null;
}

function ReviewValue({ label, value }) {
  return (
    <div className="service-order-review-row">
      <dt>{label}</dt>
      <dd>{value || <span className="service-order-empty">Not provided</span>}</dd>
    </div>
  );
}

export default function ServiceOrder() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { allServices } = useMarketplace();
  const service = allServices.find((item) => item.id === id);
  const isSellerService = Boolean(service?.ownerUsername);
  const packageOptions = service?.packages || servicePackages;
  const packageOption = packageOptions.find((item) => item.id === searchParams.get("package"));
  const [form, setForm] = useState({
    projectName: "",
    websiteType: "",
    pageCount: "",
    designStyle: "",
    description: "",
    referenceUrl: "",
    features: [],
    customerName: "",
    email: "",
    whatsapp: "",
    additionalInstructions: "",
  });
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [errors, setErrors] = useState({});
  const [demoNotice, setDemoNotice] = useState(false);

  if (!service) {
    return (
      <main className="service-detail-not-found">
        <span className="market-eyebrow">SERVICE NOT FOUND</span>
        <h1>This service isn’t available.</h1>
        <Link className="market-button market-button-primary" to="/services">Explore Services <ArrowRight size={15} /></Link>
      </main>
    );
  }

  if (!packageOption) {
    return (
      <main className="service-detail-not-found">
        <span className="market-eyebrow">CHOOSE A PACKAGE</span>
        <h1>Select a package before placing an order.</h1>
        <p>Choose the option that fits your project, then come back to share your requirements.</p>
        <Link className="market-button market-button-primary" to={`/services/${service.id}#packages`}>View packages <ArrowRight size={15} /></Link>
      </main>
    );
  }

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
    setDemoNotice(false);
  };

  const toggleFeature = (feature) => {
    setForm((current) => ({
      ...current,
      features: current.features.includes(feature)
        ? current.features.filter((item) => item !== feature)
        : [...current.features, feature],
    }));
    setDemoNotice(false);
  };

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] || null;
    setFile(null);
    setFileError("");
    setDemoNotice(false);
    if (!selectedFile) return;

    const extension = selectedFile.name.slice(selectedFile.name.lastIndexOf(".")).toLowerCase();
    if (!allowedFileExtensions.includes(extension)) {
      setFileError("Choose a PDF, DOC, DOCX, PNG, JPG or WebP file.");
      event.target.value = "";
      return;
    }
    if (selectedFile.size > maxFileSize) {
      setFileError("Your file must be 10 MB or smaller.");
      event.target.value = "";
      return;
    }
    setFile(selectedFile);
  };

  const submitOrder = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.projectName.trim()) nextErrors.projectName = "Enter a name for your project.";
    if (!form.websiteType) nextErrors.websiteType = "Choose a website type.";
    if (!/^[1-9]\d*$/.test(form.pageCount) || Number(form.pageCount) > 100) {
      nextErrors.pageCount = "Enter a page count between 1 and 100.";
    }
    if (!form.description.trim()) nextErrors.description = "Describe what you need the developer to build.";
    if (form.referenceUrl.trim()) {
      try {
        const url = new URL(form.referenceUrl.trim());
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported protocol");
      } catch {
        nextErrors.referenceUrl = "Enter a valid website URL starting with http:// or https://.";
      }
    }
    if (!form.customerName.trim()) nextErrors.customerName = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (fileError) nextErrors.file = fileError;

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setDemoNotice(false);
      const firstInvalidField = Object.keys(nextErrors)[0];
      document.getElementById(firstInvalidField === "file" ? "projectFile" : firstInvalidField)?.focus();
      return;
    }

    setDemoNotice(true);
  };

  const formattedPrice = `PKR ${currency.format(packageOption.price)}`;
  const featureSummary = form.features.length ? form.features.join(", ") : "";

  return (
    <main className="market-section service-order-page">
      <Link className="service-order-back" to={`/services/${service.id}`}>
        <ArrowLeft size={15} /> Back to service
      </Link>
      <header className="service-order-heading">
        <span className="market-eyebrow">ORDER REQUIREMENTS PREVIEW</span>
        <h1>Tell Us About Your Project</h1>
        <p>Review sample project requirements. Nothing is sent to the seller or saved.</p>
      </header>

      <div className="service-order-layout">
        <form className="service-order-form" onSubmit={submitOrder} noValidate>
          <section className="service-order-card service-order-listing">
            <div className="service-order-card-heading">
              <span className="service-order-step"><ShoppingBag size={16} /></span>
              <div><h2>Order summary</h2><p>Your selected service and package</p></div>
            </div>
            <div className="service-order-listing-content">
              <img src={service.sellerImage} alt="" />
              <div className="service-order-listing-copy">
                <span>{service.seller} · {isSellerService ? "Seller preview" : "Sample seller"}</span>
                <h3>{service.title}</h3>
                <p>{packageOption.name} package · {packageOption.deliveryDays} days</p>
              </div>
              <strong className="service-order-listing-price">{formattedPrice}</strong>
            </div>
            <div className="service-order-listing-footer">
              <span><Clock3 size={14} /> Estimated delivery: {packageOption.deliveryDays} days</span>
              <Link to={`/services/${service.id}?package=${packageOption.id}#packages`}>Edit package <ArrowRight size={13} /></Link>
            </div>
          </section>

          <section className="service-order-card">
            <div className="service-order-card-heading">
              <span className="service-order-step">01</span>
              <div><h2>Project requirements</h2><p>Help the developer understand your goals and scope.</p></div>
            </div>
            <div className="service-order-fields">
              <div className="service-order-field service-order-field-full">
                <label htmlFor="projectName">Project name <span>*</span></label>
                <input id="projectName" name="projectName" value={form.projectName} onChange={updateField} placeholder="e.g. Northstar Studio website" aria-invalid={Boolean(errors.projectName)} aria-describedby={errors.projectName ? "projectName-error" : undefined} />
                <FieldError id="projectName-error">{errors.projectName}</FieldError>
              </div>
              <div className="service-order-field">
                <label htmlFor="websiteType">Website type <span>*</span></label>
                <select id="websiteType" name="websiteType" value={form.websiteType} onChange={updateField} aria-invalid={Boolean(errors.websiteType)} aria-describedby={errors.websiteType ? "websiteType-error" : undefined}>
                  <option value="">Select a website type</option>
                  {websiteTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <FieldError id="websiteType-error">{errors.websiteType}</FieldError>
              </div>
              <div className="service-order-field">
                <label htmlFor="pageCount">Number of pages <span>*</span></label>
                <input id="pageCount" name="pageCount" type="number" min="1" max="100" step="1" value={form.pageCount} onChange={updateField} placeholder="e.g. 5" aria-invalid={Boolean(errors.pageCount)} aria-describedby={errors.pageCount ? "pageCount-error" : undefined} />
                <FieldError id="pageCount-error">{errors.pageCount}</FieldError>
              </div>
              <div className="service-order-field service-order-field-full">
                <label htmlFor="designStyle">Preferred design style <span className="service-order-optional">Optional</span></label>
                <input id="designStyle" name="designStyle" value={form.designStyle} onChange={updateField} placeholder="e.g. Minimal, modern, bold, elegant..." />
              </div>
              <div className="service-order-field service-order-field-full">
                <label htmlFor="description">Project description <span>*</span></label>
                <textarea id="description" name="description" rows="5" value={form.description} onChange={updateField} placeholder="What should your website do? Share your goals, audience, content and anything else the developer should know." aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "description-error" : undefined} />
                <FieldError id="description-error">{errors.description}</FieldError>
              </div>
              <div className="service-order-field service-order-field-full">
                <label htmlFor="referenceUrl">Reference website URL <span className="service-order-optional">Optional</span></label>
                <input id="referenceUrl" name="referenceUrl" type="url" value={form.referenceUrl} onChange={updateField} placeholder="https://example.com" aria-invalid={Boolean(errors.referenceUrl)} aria-describedby={errors.referenceUrl ? "referenceUrl-error" : undefined} />
                <FieldError id="referenceUrl-error">{errors.referenceUrl}</FieldError>
              </div>
              <fieldset className="service-order-field service-order-field-full service-order-feature-set">
                <legend>Required features <span className="service-order-optional">Select all that apply</span></legend>
                <div className="service-order-feature-grid">
                  {requiredFeatures.map((feature) => (
                    <label className="service-order-checkbox" key={feature}>
                      <input type="checkbox" checked={form.features.includes(feature)} onChange={() => toggleFeature(feature)} />
                      <span className="service-order-checkmark"><Check size={12} /></span>{feature}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>

          <section className="service-order-card">
            <div className="service-order-card-heading">
              <span className="service-order-step"><UserRound size={16} /></span>
              <div><h2>Your details</h2><p>How the developer can get in touch with you.</p></div>
            </div>
            <div className="service-order-fields">
              <div className="service-order-field">
                <label htmlFor="customerName">Customer name <span>*</span></label>
                <input id="customerName" name="customerName" autoComplete="name" value={form.customerName} onChange={updateField} placeholder="Your full name" aria-invalid={Boolean(errors.customerName)} aria-describedby={errors.customerName ? "customerName-error" : undefined} />
                <FieldError id="customerName-error">{errors.customerName}</FieldError>
              </div>
              <div className="service-order-field">
                <label htmlFor="email">Email address <span>*</span></label>
                <input id="email" name="email" type="email" autoComplete="email" value={form.email} onChange={updateField} placeholder="you@example.com" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} />
                <FieldError id="email-error">{errors.email}</FieldError>
              </div>
              <div className="service-order-field service-order-field-full">
                <label htmlFor="whatsapp">WhatsApp number <span className="service-order-optional">Optional</span></label>
                <input id="whatsapp" name="whatsapp" type="tel" autoComplete="tel" value={form.whatsapp} onChange={updateField} placeholder="+92 300 1234567" />
              </div>
            </div>
          </section>

          <section className="service-order-card">
            <div className="service-order-card-heading">
              <span className="service-order-step"><Paperclip size={16} /></span>
              <div><h2>Additional information</h2><p>Add helpful documents or a note for the developer.</p></div>
            </div>
            <div className="service-order-fields">
              <div className="service-order-field service-order-field-full">
                <label htmlFor="projectFile">Project files <span className="service-order-optional">Optional · Up to 10 MB</span></label>
                <div className="service-order-file-control">
                  <input id="projectFile" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={handleFileChange} aria-describedby={errors.file ? "file-error" : "file-help"} aria-invalid={Boolean(errors.file)} />
                  <span id="file-help">PDF, DOC, DOCX, PNG, JPG or WebP</span>
                </div>
                {file && <div className="service-order-file-selected"><FileText size={15} /><span>{file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MB</span><button type="button" onClick={() => { setFile(null); setFileError(""); document.getElementById("projectFile").value = ""; }} aria-label="Remove attached file"><X size={15} /></button></div>}
                <FieldError id="file-error">{errors.file || fileError}</FieldError>
              </div>
              <div className="service-order-field service-order-field-full">
                <label htmlFor="additionalInstructions">Additional instructions <span className="service-order-optional">Optional</span></label>
                <textarea id="additionalInstructions" name="additionalInstructions" rows="3" value={form.additionalInstructions} onChange={updateField} placeholder="Anything else you'd like the developer to keep in mind?" />
              </div>
            </div>
          </section>

          <div className="service-order-submit-area">
            <div className="service-order-demo-notice" role="note">
              <strong>Payments are not enabled in this demo.</strong>
              <span>No card details are requested, no payment is processed, and no order is submitted.</span>
            </div>
            <button type="submit" className="market-button market-button-primary service-order-submit">Preview order requirements <ArrowRight size={15} /></button>
            <p>This marketplace is in demo mode. Your details and any attachment will not be sent or saved.</p>
            {demoNotice && (
              <div className="service-order-demo-notice" role="status">
                <strong>Your requirements are ready to review.</strong>
                <span>This demo has no order backend, so nothing was submitted or saved. Connect an order service to accept this request.</span>
              </div>
            )}
          </div>
        </form>

        <aside className="service-order-review">
          <div className="service-order-review-card">
            <div className="service-order-review-title"><FileText size={16} /><h2>Order review</h2></div>
            <div className="service-order-review-service">
              <img src={service.sellerImage} alt="" />
              <div><span>{service.seller}</span><strong>{service.title}</strong></div>
            </div>
            <dl className="service-order-review-list">
              <ReviewValue label="Package" value={packageOption.name} />
              <ReviewValue label="Total price" value={formattedPrice} />
              <ReviewValue label="Delivery estimate" value={`${packageOption.deliveryDays} days`} />
            </dl>
            <div className="service-order-review-divider" />
            <h3>Your requirements</h3>
            <dl className="service-order-review-list">
              <ReviewValue label="Project" value={form.projectName} />
              <ReviewValue label="Website type" value={form.websiteType} />
              <ReviewValue label="Number of pages" value={form.pageCount} />
              <ReviewValue label="Design style" value={form.designStyle} />
              <ReviewValue label="Description" value={form.description} />
              <ReviewValue label="Reference website" value={form.referenceUrl} />
              <ReviewValue label="Features" value={featureSummary} />
              <ReviewValue label="Customer" value={form.customerName} />
              <ReviewValue label="Email" value={form.email} />
              <ReviewValue label="WhatsApp" value={form.whatsapp} />
              <ReviewValue label="Attachment" value={file?.name} />
              <ReviewValue label="Additional instructions" value={form.additionalInstructions} />
            </dl>
            <div className="service-order-review-total"><span>Total</span><strong>{formattedPrice}</strong></div>
            <div className="service-order-review-demo"><Clock3 size={14} /><span>{packageOption.deliveryDays}-day delivery · {isSellerService ? "Seller preview in demo mode" : "Sample listing for demonstration"}</span></div>
          </div>
        </aside>
      </div>
    </main>
  );
}
