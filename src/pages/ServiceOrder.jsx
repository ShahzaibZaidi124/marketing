import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Clock3, FileText, ShoppingBag } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useMarketplace } from "../context/MarketplaceContext.jsx";
import {
  buildPlaceOrderRequest,
  getCatalogLoadErrorMessage,
  getOrderableService,
  submitClientOrder,
  validateOrderDraft,
} from "../lib/serviceCatalog.js";

function formatPrice(price, currency = "PKR") {
  const value = Number(price);
  if (!Number.isFinite(value) || value < 0) return "Price unavailable";
  return `${currency} ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(value)}`;
}

function FieldError({ id, children }) {
  return children ? <span className="service-order-error" id={id}>{children}</span> : null;
}

export default function ServiceOrder() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { allServices } = useMarketplace();
  const servicePreview = allServices.find((item) => item.id === id);
  const [catalogService, setCatalogService] = useState(null);
  const [packageId, setPackageId] = useState(searchParams.get("package") || "");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [form, setForm] = useState({ projectName: "", orderDescription: "", requirements: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError("");
    getOrderableService(id)
      .then((loadedService) => {
        if (!active) return;
        setCatalogService(loadedService);
        const selectedPackage = loadedService?.packages.find((item) => item.id === searchParams.get("package"));
        setPackageId(selectedPackage?.id || loadedService?.packages[0]?.id || "");
      })
      .catch((error) => {
        if (!active) return;
        setCatalogError(getCatalogLoadErrorMessage(error));
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, searchParams, catalogAttempt]);

  const selectedPackage = catalogService?.packages.find((item) => item.id === packageId) || null;
  const actualPrice = selectedPackage?.price ?? catalogService?.base_price;
  const actualCurrency = selectedPackage?.currency || catalogService?.currency || "PKR";
  const displayName = catalogService?.name || servicePreview?.title || "Service";

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: "" }));
    setSubmitError("");
  };

  const submitOrder = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setSubmitError("");
    const nextErrors = validateOrderDraft(form);
    if (catalogService?.packages.length && !packageId) {
      nextErrors.packageId = "Choose a package.";
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      document.getElementById(Object.keys(nextErrors)[0])?.focus();
      return;
    }
    if (!user) {
      setSubmitError("Sign in to your client account before placing an order.");
      return;
    }
    if (!catalogService) {
      setSubmitError("This listing is not in the orderable service catalog yet. No order was submitted.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await submitClientOrder(user.id, buildPlaceOrderRequest({
        serviceId: catalogService.id,
        packageId,
        ...form,
      }));
      navigate("/customer/dashboard", {
        replace: true,
        state: { section: "orders", orderCreated: true },
      });
    } catch (error) {
      setSubmitError(error instanceof Error
        ? error.message
        : "Your order could not be submitted. Please try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (!servicePreview) {
    return (
      <main className="service-detail-not-found">
        <span className="market-eyebrow">SERVICE NOT FOUND</span>
        <h1>This service isn’t available.</h1>
        <Link className="market-button market-button-primary" to="/services">Explore Services <ArrowRight size={15} /></Link>
      </main>
    );
  }

  const orderable = Boolean(catalogService && actualPrice !== null && actualPrice !== undefined);
  const formattedPrice = orderable ? formatPrice(actualPrice, actualCurrency) : "Unavailable";

  return (
    <main className="market-section service-order-page">
      <Link className="service-order-back" to={`/services/${id}`}>
        <ArrowLeft size={15} /> Back to service
      </Link>
      <header className="service-order-heading">
        <span className="market-eyebrow">CLIENT ORDER</span>
        <h1>Place an Order</h1>
        <p>Describe the project you want completed. An order is created only after the server confirms it.</p>
      </header>

      <div className="service-order-layout">
        <form className="service-order-form" onSubmit={submitOrder} noValidate>
          <section className="service-order-card service-order-listing">
            <div className="service-order-card-heading">
              <span className="service-order-step"><ShoppingBag size={16} /></span>
              <div><h2>Order summary</h2><p>Verified from the published service catalog</p></div>
            </div>
            <div className="service-order-listing-content">
              {servicePreview.sellerImage && <img src={servicePreview.sellerImage} alt="" />}
              <div className="service-order-listing-copy">
                <span>{catalogService ? "Available service" : "Preview listing"}</span>
                <h3>{displayName}</h3>
                <p>{selectedPackage?.name || "Standard service"}{selectedPackage ? " package" : ""}</p>
              </div>
              <strong className="service-order-listing-price">{catalogLoading ? "Loading…" : formattedPrice}</strong>
            </div>
            {selectedPackage?.description && <p className="service-order-project">{selectedPackage.description}</p>}
            {catalogLoading && <p className="service-order-catalog-message" role="status">Checking current service availability…</p>}
            {!catalogLoading && !catalogError && !catalogService && (
              <p className="service-order-catalog-message" role="status">
                This preview listing has not been added to the orderable catalog. No order can be placed for it yet.
              </p>
            )}
            {catalogError && (
              <div className="service-order-feedback service-order-feedback-error" role="alert">
                <span>{catalogError}</span>
                <button type="button" onClick={() => setCatalogAttempt((attempt) => attempt + 1)}>Retry</button>
              </div>
            )}
            {catalogService?.packages.length > 0 && (
              <div className="service-order-field service-order-package-select">
                <label htmlFor="packageId">Package <span>*</span></label>
                <select
                  id="packageId"
                  value={packageId}
                  onChange={(event) => setPackageId(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.packageId)}
                  aria-describedby={fieldErrors.packageId ? "packageId-error" : undefined}
                >
                  {catalogService.packages.map((option) => (
                    <option key={option.id} value={option.id}>{option.name} · {formatPrice(option.price, option.currency)}</option>
                  ))}
                </select>
                <FieldError id="packageId-error">{fieldErrors.packageId}</FieldError>
              </div>
            )}
          </section>

          <section className="service-order-card">
            <div className="service-order-card-heading">
              <span className="service-order-step">01</span>
              <div><h2>Project details</h2><p>Required information for the client order.</p></div>
            </div>
            <div className="service-order-fields">
              <div className="service-order-field service-order-field-full">
                <label htmlFor="projectName">Project name <span>*</span></label>
                <input
                  id="projectName"
                  name="projectName"
                  maxLength={120}
                  value={form.projectName}
                  onChange={updateField}
                  placeholder="Name this project"
                  aria-invalid={Boolean(fieldErrors.projectName)}
                  aria-describedby={fieldErrors.projectName ? "projectName-error" : undefined}
                  required
                />
                <FieldError id="projectName-error">{fieldErrors.projectName}</FieldError>
              </div>
              <div className="service-order-field service-order-field-full">
                <label htmlFor="orderDescription">Order description <span>*</span></label>
                <textarea
                  id="orderDescription"
                  name="orderDescription"
                  rows="5"
                  maxLength={5000}
                  value={form.orderDescription}
                  onChange={updateField}
                  placeholder="Describe the work you need and the outcome you expect."
                  aria-invalid={Boolean(fieldErrors.orderDescription)}
                  aria-describedby={fieldErrors.orderDescription ? "orderDescription-error" : undefined}
                  required
                />
                <FieldError id="orderDescription-error">{fieldErrors.orderDescription}</FieldError>
              </div>
              <div className="service-order-field service-order-field-full">
                <label htmlFor="requirements">Requirements <span className="service-order-optional">Optional</span></label>
                <textarea
                  id="requirements"
                  name="requirements"
                  rows="4"
                  maxLength={10000}
                  value={form.requirements}
                  onChange={updateField}
                  placeholder="List content, features, references, or other project requirements."
                  aria-invalid={Boolean(fieldErrors.requirements)}
                  aria-describedby={fieldErrors.requirements ? "requirements-error" : undefined}
                />
                <FieldError id="requirements-error">{fieldErrors.requirements}</FieldError>
              </div>
            </div>
          </section>

          {!authLoading && !user && (
            <div className="service-order-feedback service-order-feedback-error" role="status">
              Sign in to your client account using the site header before placing an order.
            </div>
          )}
          {submitError && <div className="service-order-feedback service-order-feedback-error" role="alert">{submitError}</div>}
          <div className="service-order-submit-area">
            <button
              type="submit"
              className="market-button market-button-primary service-order-submit"
              disabled={authLoading || !user || !orderable || catalogLoading || Boolean(catalogError) || submitting}
            >
              {submitting ? "Submitting order…" : "Place Order"} <ArrowRight size={15} />
            </button>
            <p>Your service and package price are verified by the server. No payment is processed by this action.</p>
          </div>
        </form>

        <aside className="service-order-review">
          <div className="service-order-review-card">
            <div className="service-order-review-title"><FileText size={16} /><h2>Order review</h2></div>
            <div className="service-order-review-service">
              {servicePreview.sellerImage && <img src={servicePreview.sellerImage} alt="" />}
              <div><span>{catalogService ? "Published service" : "Preview only"}</span><strong>{displayName}</strong></div>
            </div>
            <dl className="service-order-review-list">
              <div className="service-order-review-row"><dt>Package</dt><dd>{selectedPackage?.name || "No package selected"}</dd></div>
              <div className="service-order-review-row"><dt>Price</dt><dd>{formattedPrice}</dd></div>
              <div className="service-order-review-row"><dt>Project</dt><dd>{form.projectName.trim() || "Not provided"}</dd></div>
              <div className="service-order-review-row"><dt>Description</dt><dd>{form.orderDescription.trim() || "Not provided"}</dd></div>
            </dl>
            {selectedPackage?.description && (
              <div className="service-order-review-demo"><Clock3 size={14} /><span>{selectedPackage.description}</span></div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
