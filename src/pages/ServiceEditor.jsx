import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Eye,
  FileImage,
  ImagePlus,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { servicePackages } from "../data/services.js";
import { getActiveServiceCategories, getServiceCategoriesErrorMessage } from "../lib/serviceCategories.js";
import { useMarketplace } from "../context/MarketplaceContext.jsx";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxImageSize = 6 * 1024 * 1024;
const maxImages = 6;
const requirementOptions = [
  "Business name",
  "Logo",
  "Website content",
  "Brand colors",
  "Reference websites",
  "Required features",
];
const currency = new Intl.NumberFormat("en-PK");
const defaultPages = [1, 5, 10];
const defaultRevisions = [1, 3, 5];

function commaValues(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function ServiceFieldError({ id, children }) {
  return children ? <span className="seller-field-error" id={id} role="alert">{children}</span> : null;
}

function makeDefaultPackages(existingPackages) {
  return servicePackages.map((packageOption, index) => {
    const saved = existingPackages?.find((item) => item.id === packageOption.id);
    return {
      id: packageOption.id,
      enabled: saved ? saved.enabled !== false : true,
      name: saved?.name || packageOption.name,
      description: saved?.description || saved?.summary || packageOption.summary,
      price: String(saved?.price ?? packageOption.price),
      deliveryDays: String(saved?.deliveryDays ?? packageOption.deliveryDays),
      pages: String(saved?.pages ?? defaultPages[index]),
      revisions: String(saved?.revisions ?? defaultRevisions[index]),
    };
  });
}

function makeInitialImages(service) {
  if (service?.images?.length) return service.images;
  return service?.image ? [{ id: `${service.id}-main`, name: "Service preview", url: service.image, isTemporary: false }] : [];
}

function ServicePackageEditor({ packageOption, index, error, onToggle, onChange }) {
  const packageId = packageOption.id;
  const fields = [
    { name: "name", label: "Package name", type: "text", placeholder: packageOption.name },
    { name: "description", label: "Package description", type: "text", placeholder: "Describe what's included" },
    { name: "price", label: "Price (PKR)", type: "number", min: "1", placeholder: "10000" },
    { name: "deliveryDays", label: "Delivery time (days)", type: "number", min: "1", max: "365", placeholder: "5" },
    { name: "pages", label: "Website pages", type: "number", min: "1", max: "100", placeholder: "5" },
    { name: "revisions", label: "Revisions included", type: "number", min: "0", max: "100", placeholder: "2" },
  ];

  return (
    <article className={`seller-service-package-editor${packageOption.enabled ? " seller-service-package-enabled" : ""}`}>
      <header className="seller-service-package-header">
        <div><span className="seller-service-package-index">0{index + 1}</span><h3>{packageOption.name || "New package"}</h3></div>
        <label className="seller-package-toggle">
          <input type="checkbox" checked={packageOption.enabled} onChange={() => onToggle(packageId)} />
          <span>{packageOption.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </header>
      {packageOption.enabled && (
        <div className="seller-service-package-fields">
          {fields.map((field) => {
            const fieldError = error?.[field.name];
            const fieldId = `package-${packageId}-${field.name}`;
            return (
              <div className={`seller-field${field.name === "description" ? " seller-field-full" : ""}`} key={field.name}>
                <label htmlFor={fieldId}>{field.label} <span>*</span></label>
                <input
                  id={fieldId}
                  type={field.type}
                  min={field.min}
                  max={field.max}
                  step={field.type === "number" ? "1" : undefined}
                  value={packageOption[field.name]}
                  onChange={(event) => onChange(packageId, field.name, event.target.value)}
                  placeholder={field.placeholder}
                  aria-invalid={Boolean(fieldError)}
                  aria-describedby={fieldError ? `${fieldId}-error` : undefined}
                />
                <ServiceFieldError id={`${fieldId}-error`}>{fieldError}</ServiceFieldError>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

export default function ServiceEditor() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams();
  const sellerProfile = location.state?.sellerProfile;
  const { profilePictureUrl } = useAuth();
  const { getOwnedService, saveSellerService } = useMarketplace();
  const editing = Boolean(id);
  const existingService = editing && sellerProfile ? getOwnedService(id, sellerProfile.username) : null;
  const [images, setImages] = useState(() => makeInitialImages(existingService));
  const [mainImageIndex, setMainImageIndex] = useState(0);
  const [form, setForm] = useState(() => ({
    title: existingService?.title || "",
    categoryId: existingService?.categoryId || "",
    tags: existingService?.tags?.join(", ") || "",
    description: existingService?.description || "",
    technologies: existingService?.details?.technologies?.join(", ") || "",
    packages: makeDefaultPackages(existingService?.packageDrafts || existingService?.packages),
    requirements: existingService?.requirements?.filter((item) => requirementOptions.includes(item)) || requirementOptions,
    customQuestionInput: "",
    customRequirements: existingService?.requirements?.filter((item) => !requirementOptions.includes(item)) || [],
  }));
  const [errors, setErrors] = useState({});
  const [imageError, setImageError] = useState("");
  const sellerAvatar = profilePictureUrl || sellerProfile?.avatar || "";

  // The live category list for customers: active categories only, read from the
  // database. RLS already hides inactive rows from ordinary users; a change made
  // in the admin dashboard shows up here after a refresh.
  const [liveCategories, setLiveCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState("");

  useEffect(() => {
    let active = true;
    setCategoriesLoading(true);
    setCategoriesError("");

    getActiveServiceCategories()
      .then((data) => { if (active) { setLiveCategories(data); setCategoriesError(""); } })
      .catch((error) => { if (active) { setLiveCategories([]); setCategoriesError(getServiceCategoriesErrorMessage(error)); } })
      .finally(() => { if (active) setCategoriesLoading(false); });

    return () => { active = false; };
  }, []);

  if (!sellerProfile) return <Navigate to="/seller/register" replace />;
  if (editing && !existingService) {
    return (
      <main className="market-section seller-page seller-service-not-found">
        <span className="market-eyebrow">SERVICE UNAVAILABLE</span>
        <h1>This service can’t be edited from this seller account.</h1>
        <p>Seller previews can only be edited by the account that created them in this browser session.</p>
        <Link className="market-button market-button-primary" to="/seller/dashboard" state={{ sellerProfile }}>Back to dashboard</Link>
      </main>
    );
  }

  const updateForm = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
  };

  const updatePackage = (packageId, field, value) => {
    setForm((current) => ({
      ...current,
      packages: current.packages.map((packageOption) => packageOption.id === packageId
        ? { ...packageOption, [field]: value }
        : packageOption),
    }));
    setErrors((current) => ({
      ...current,
      packages: { ...current.packages, [packageId]: { ...current.packages?.[packageId], [field]: "" } },
    }));
  };

  const togglePackage = (packageId) => {
    const enabling = !form.packages.find((packageOption) => packageOption.id === packageId)?.enabled;
    setForm((current) => ({
      ...current,
      packages: current.packages.map((packageOption) => packageOption.id === packageId
        ? { ...packageOption, enabled: !packageOption.enabled }
        : packageOption),
    }));
    if (enabling) {
      setErrors((current) => {
        const packages = { ...current.packages };
        delete packages.general;
        return { ...current, packages };
      });
    }
  };

  const toggleRequirement = (requirement) => {
    setForm((current) => ({
      ...current,
      requirements: current.requirements.includes(requirement)
        ? current.requirements.filter((item) => item !== requirement)
        : [...current.requirements, requirement],
    }));
  };

  const addCustomRequirement = () => {
    const question = form.customQuestionInput.trim();
    if (!question) {
      setErrors((current) => ({ ...current, customQuestionInput: "Enter a requirement question first." }));
      return;
    }
    if (form.customRequirements.includes(question)) {
      setErrors((current) => ({ ...current, customQuestionInput: "That question is already on your list." }));
      return;
    }
    setForm((current) => ({
      ...current,
      customQuestionInput: "",
      customRequirements: [...current.customRequirements, question],
    }));
    setErrors((current) => ({ ...current, customQuestionInput: "" }));
  };

  const addImages = (event) => {
    const files = Array.from(event.target.files || []);
    const nextImages = [];
    let message = "";
    if (images.length + files.length > maxImages) message = `Add up to ${maxImages} images in total.`;
    files.slice(0, Math.max(0, maxImages - images.length)).forEach((file, index) => {
      if (!imageTypes.includes(file.type)) message = "Use JPG, PNG or WebP images.";
      else if (file.size > maxImageSize) message = "Each image must be 6 MB or smaller.";
      else {
        nextImages.push({
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          url: URL.createObjectURL(file),
          isTemporary: true,
        });
      }
    });
    if (nextImages.length) {
      setImages((current) => [...current, ...nextImages]);
      setErrors((current) => ({ ...current, images: "" }));
    }
    setImageError(message);
    event.target.value = "";
  };

  const removeImage = (imageId) => {
    const removed = images.find((image) => image.id === imageId);
    if (removed?.isTemporary && removed.url.startsWith("blob:")) URL.revokeObjectURL(removed.url);
    const nextImages = images.filter((image) => image.id !== imageId);
    setImages(nextImages);
    setMainImageIndex(0);
    if (nextImages.length > 0) setErrors((current) => ({ ...current, images: "" }));
  };

  const enabledPackages = form.packages.filter((packageOption) => packageOption.enabled);
  const parsedTags = commaValues(form.tags);
  const parsedTechnologies = commaValues(form.technologies);
  const completeSections = [
    Boolean(form.title.trim() && form.categoryId && form.description.trim() && parsedTags.length && parsedTechnologies.length),
    images.length > 0,
    enabledPackages.length > 0,
    form.requirements.length + form.customRequirements.length > 0,
  ].filter(Boolean).length;
  const progress = Math.round((completeSections / 4) * 100);
  // The options shown to the seller: the live active categories, plus the
  // service's current category if it is no longer active, so editing an existing
  // service never silently drops its assignment.
  const categoryOptions = form.categoryId && !liveCategories.some((category) => category.id === form.categoryId)
    ? [{ id: form.categoryId, name: existingService?.category || form.categoryId }, ...liveCategories]
    : liveCategories;
  const selectedCategory = categoryOptions.find((category) => category.id === form.categoryId);
  const currentImage = images[mainImageIndex] || images[0];

  const validate = (action) => {
    const nextErrors = {};
    if (form.title.trim().length < 10) nextErrors.title = "Enter a service title with at least 10 characters.";
    if (!selectedCategory) nextErrors.categoryId = "Choose a service category.";

    if (action === "published") {
      if (form.description.trim().length < 40) nextErrors.description = "Write at least 40 characters describing your service.";
      if (!parsedTags.length) nextErrors.tags = "Add at least one search tag.";
      if (!parsedTechnologies.length) nextErrors.technologies = "Add at least one technology.";
      if (images.length === 0) nextErrors.images = "Add at least one preview image.";
      if (enabledPackages.length === 0) nextErrors.packages = { general: "Enable at least one package." };

      enabledPackages.forEach((packageOption) => {
        const packageErrors = {};
        if (packageOption.name.trim().length < 2) packageErrors.name = "Add a package name.";
        if (packageOption.description.trim().length < 10) packageErrors.description = "Add a package description.";
        if (!/^[1-9]\d*$/.test(packageOption.price)) packageErrors.price = "Enter a price greater than zero.";
        if (!/^[1-9]\d*$/.test(packageOption.deliveryDays) || Number(packageOption.deliveryDays) > 365) packageErrors.deliveryDays = "Use 1–365 days.";
        if (!/^[1-9]\d*$/.test(packageOption.pages) || Number(packageOption.pages) > 100) packageErrors.pages = "Use 1–100 pages.";
        if (!/^(0|[1-9]\d*)$/.test(packageOption.revisions) || Number(packageOption.revisions) > 100) packageErrors.revisions = "Use 0–100 revisions.";
        if (Object.keys(packageErrors).length) {
          if (!nextErrors.packages) nextErrors.packages = {};
          nextErrors.packages[packageOption.id] = packageErrors;
        }
      });

      if (form.requirements.length + form.customRequirements.length === 0) {
        nextErrors.requirements = "Select or add at least one customer requirement.";
      }
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const fieldOrder = ["title", "categoryId", "description", "tags", "technologies", "images", "requirements"];
      const firstField = fieldOrder.find((field) => nextErrors[field]);
      const firstPackage = nextErrors.packages && Object.keys(nextErrors.packages)[0];
      const firstPackageField = firstPackage && Object.keys(nextErrors.packages[firstPackage])[0];
      const fieldId = firstField
        ? `service-${firstField}`
        : firstPackageField
          ? `package-${firstPackage}-${firstPackageField}`
          : null;
      const focusTarget = fieldId || (nextErrors.requirements ? "service-requirements" : null);
      document.getElementById(focusTarget)?.focus();
      return false;
    }
    return true;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const action = event.nativeEvent.submitter?.value;
    if (!["draft", "published"].includes(action)) return;
    if (!validate(action)) return;

    const finalPackages = enabledPackages.map((packageOption) => ({
      id: packageOption.id,
      name: packageOption.name.trim(),
      summary: packageOption.description.trim(),
      price: Number(packageOption.price),
      deliveryDays: Number(packageOption.deliveryDays),
      pages: Number(packageOption.pages),
      revisions: Number(packageOption.revisions),
      features: [
        `${packageOption.pages}-page website`,
        `${packageOption.revisions} revisions`,
        "Responsive design",
      ],
    }));
    const mainImage = images[mainImageIndex] || images[0];
    const orderedImages = mainImage
      ? [mainImage, ...images.filter((image) => image.id !== mainImage.id)]
      : [];
    const initials = sellerProfile.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const details = {
      detailTitle: form.title.trim(),
      about: form.description.trim(),
      features: finalPackages[0]?.features || parsedTechnologies,
      technologies: parsedTechnologies,
      galleryImages: orderedImages.slice(1).map((image) => image.url),
      sellerBio: `${sellerProfile.displayName} is a ${sellerProfile.experience.toLowerCase()} website developer.`,
      skills: sellerProfile.skills,
      portfolio: [],
    };
    const service = {
      id: existingService?.id || `seller-${sellerProfile.username}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      ownerUsername: sellerProfile.username,
      status: action,
      categoryId: selectedCategory.id,
      category: selectedCategory.name,
      title: form.title.trim(),
      description: form.description.trim(),
      seller: sellerProfile.displayName,
      sellerInitials: initials,
      sellerImage: sellerProfile.avatar || images[0]?.url || "",
      price: finalPackages.length ? Math.min(...finalPackages.map((packageOption) => packageOption.price)) : 0,
      deliveryDays: finalPackages.length ? Math.min(...finalPackages.map((packageOption) => packageOption.deliveryDays)) : 0,
      createdAt: existingService?.createdAt || new Date().toISOString().slice(0, 10),
      recommendedOrder: 999,
      tags: parsedTags,
      technologies: parsedTechnologies,
      previewBrand: sellerProfile.username,
      previewHeadline: form.title.trim(),
      image: orderedImages[0]?.url || "",
      images: orderedImages,
      galleryImages: orderedImages.slice(1).map((image) => image.url),
      packages: finalPackages,
      packageDrafts: form.packages.map((packageOption) => ({ ...packageOption })),
      requirements: [...form.requirements, ...form.customRequirements],
      details,
    };

    if (!saveSellerService(service, sellerProfile.username)) {
      setErrors({ form: "Could not save this preview service for the current seller account." });
      return;
    }

    navigate("/seller/dashboard", {
      state: {
        sellerProfile,
        serviceResult: { id: service.id, title: service.title, status: service.status },
      },
    });
  };

  const setPackageField = (packageId, field, value) => updatePackage(packageId, field, value);

  return (
    <main className="market-section seller-page seller-service-editor-page">
      <Link className="seller-back-link" to="/seller/dashboard" state={{ sellerProfile }}><ArrowLeft size={14} /> Back to dashboard</Link>
      <header className="seller-page-heading seller-service-editor-heading">
        <span className="market-eyebrow">{editing ? "EDIT YOUR SERVICE · DEMO" : "SELLER WORKSPACE · DEMO"}</span>
        <h1>{editing ? "Edit Your Service" : "Create a New Service"}</h1>
        <p>Showcase your skills and attract customers by publishing your website development service.</p>
      </header>
      <div className="seller-service-demo-note"><Eye size={16} /><span>Demo mode: changes are kept in browser memory only. They are not permanently saved or published to a server.</span></div>

      <div className="seller-service-editor-layout">
        <form className="seller-service-form" onSubmit={handleSubmit} noValidate>
          <section className="seller-form-card seller-service-section">
            <header className="seller-form-card-heading">
              <span className="seller-form-step-number">01</span>
              <div><h2>Service information</h2><p>Tell customers what you offer and how to find it.</p></div>
            </header>
            <div className="seller-profile-completion seller-service-progress">
              <div className="seller-profile-completion-top"><span>Service setup progress</span><strong>{progress}%</strong></div>
              <div className="seller-profile-progress" role="progressbar" aria-label="Service setup progress" aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${progress}%` }} /></div>
              <small>Complete service details, images, packages and customer requirements.</small>
            </div>
            {errors.form && <div className="seller-service-inline-error" role="alert">{errors.form}</div>}
            <div className="seller-form-grid">
              <div className="seller-field seller-field-full">
                <label htmlFor="service-title">Service title <span>*</span></label>
                <input id="service-title" name="title" value={form.title} onChange={updateForm} placeholder="I will create a professional business website" aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "service-title-error" : undefined} />
                <ServiceFieldError id="service-title-error">{errors.title}</ServiceFieldError>
              </div>
              <div className="seller-field">
                <label htmlFor="service-categoryId">Category <span>*</span></label>
                <select id="service-categoryId" name="categoryId" value={form.categoryId} onChange={updateForm} disabled={categoriesLoading} aria-invalid={Boolean(errors.categoryId)} aria-describedby={errors.categoryId ? "service-categoryId-error" : undefined}>
                  <option value="">{categoriesLoading ? "Loading categories…" : "Choose a category"}</option>
                  {categoryOptions.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
                </select>
                {categoriesError && <span className="seller-field-error" role="alert">{categoriesError}</span>}
                <ServiceFieldError id="service-categoryId-error">{errors.categoryId}</ServiceFieldError>
              </div>
              <div className="seller-field">
                <label htmlFor="service-tags">Search tags <span>*</span></label>
                <input id="service-tags" name="tags" value={form.tags} onChange={updateForm} placeholder="business, responsive, wordpress" aria-invalid={Boolean(errors.tags)} aria-describedby={errors.tags ? "service-tags-error" : "service-tags-help"} />
                <span className="seller-field-hint" id="service-tags-help">Separate keywords with commas.</span>
                <ServiceFieldError id="service-tags-error">{errors.tags}</ServiceFieldError>
                {parsedTags.length > 0 && <div className="seller-service-chip-list">{parsedTags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
              </div>
              <div className="seller-field seller-field-full">
                <label htmlFor="service-description">Service description <span>*</span></label>
                <textarea id="service-description" name="description" rows="6" value={form.description} onChange={updateForm} placeholder="Explain what you offer, who your service is for, what's included and what makes your approach useful." aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "service-description-error" : "service-description-help"} />
                <span className="seller-field-hint" id="service-description-help">Write a clear, specific description. Avoid guarantees you cannot make.</span>
                <ServiceFieldError id="service-description-error">{errors.description}</ServiceFieldError>
              </div>
              <div className="seller-field seller-field-full">
                <label htmlFor="service-technologies">Technologies <span>*</span></label>
                <input id="service-technologies" name="technologies" value={form.technologies} onChange={updateForm} placeholder="React, HTML, CSS, JavaScript, WordPress" aria-invalid={Boolean(errors.technologies)} aria-describedby={errors.technologies ? "service-technologies-error" : "service-technologies-help"} />
                <span className="seller-field-hint" id="service-technologies-help">Separate technologies with commas.</span>
                <ServiceFieldError id="service-technologies-error">{errors.technologies}</ServiceFieldError>
                {parsedTechnologies.length > 0 && <div className="seller-service-chip-list">{parsedTechnologies.map((technology) => <span key={technology}>{technology}</span>)}</div>}
              </div>
            </div>
          </section>

          <section className="seller-form-card seller-service-section">
            <header className="seller-form-card-heading">
              <span className="seller-form-step-number">02</span>
              <div><h2>Service images</h2><p>Upload up to {maxImages} preview images. The first is your main thumbnail.</p></div>
            </header>
            <label className="seller-service-image-upload" htmlFor="service-images">
              <ImagePlus size={22} />
              <strong>Add website preview images</strong>
              <span>JPG, PNG or WebP · Up to 6 MB each · Not uploaded in demo</span>
              <input id="service-images" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addImages} aria-invalid={Boolean(errors.images || imageError)} aria-describedby={errors.images ? "service-images-error" : "service-images-help"} />
            </label>
            <span className="seller-field-hint" id="service-images-help">Use images that represent your work and that you have permission to share.</span>
            <ServiceFieldError id="service-images-error">{errors.images || imageError}</ServiceFieldError>
            {images.length > 0 && (
              <div className="seller-service-image-grid">
                {images.map((image, index) => (
                  <article className={`seller-service-image-item${index === mainImageIndex ? " seller-service-image-main" : ""}`} key={image.id}>
                    <button className="seller-service-image-select" type="button" onClick={() => setMainImageIndex(index)} aria-label={`Set ${image.name} as main preview`} aria-pressed={mainImageIndex === index}>
                      <img src={image.url} alt={`Preview ${index + 1}: ${image.name}`} />
                      {index === mainImageIndex && <span>Main thumbnail</span>}
                    </button>
                    <button className="seller-service-image-remove" type="button" onClick={() => removeImage(image.id)} aria-label={`Remove ${image.name}`}><X size={14} /></button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="seller-form-card seller-service-section">
            <header className="seller-form-card-heading">
              <span className="seller-form-step-number">03</span>
              <div><h2>Pricing packages</h2><p>Offer up to three options with clear scope and delivery times.</p></div>
            </header>
            <ServiceFieldError id="service-packages-error">{errors.packages?.general}</ServiceFieldError>
            <div className="seller-service-package-list">
              {form.packages.map((packageOption, index) => (
                <ServicePackageEditor
                  key={packageOption.id}
                  packageOption={packageOption}
                  index={index}
                  error={errors.packages?.[packageOption.id]}
                  onToggle={togglePackage}
                  onChange={setPackageField}
                />
              ))}
            </div>
          </section>

          <section className="seller-form-card seller-service-section">
            <header className="seller-form-card-heading">
              <span className="seller-form-step-number">04</span>
              <div><h2>Customer requirements</h2><p>Tell customers what information to prepare before work starts.</p></div>
            </header>
            <fieldset className="seller-service-requirements" id="service-requirements" tabIndex="-1" aria-invalid={Boolean(errors.requirements)} aria-describedby={errors.requirements ? "service-requirements-error" : undefined}>
              <legend>Information to request from customers</legend>
              <div className="seller-service-requirement-grid">
                {requirementOptions.map((requirement) => (
                  <label className="seller-service-requirement" key={requirement}>
                    <input type="checkbox" checked={form.requirements.includes(requirement)} onChange={() => toggleRequirement(requirement)} />
                    <span><Check size={12} /></span>{requirement}
                  </label>
                ))}
              </div>
            </fieldset>
            {errors.requirements && <ServiceFieldError id="service-requirements-error">{errors.requirements}</ServiceFieldError>}
            <div className="seller-field seller-service-custom-question">
              <label htmlFor="service-custom-requirement">Add a custom requirement question <span className="seller-optional">Optional</span></label>
              <div className="seller-service-custom-question-row">
                <input id="service-custom-requirement" value={form.customQuestionInput} onChange={(event) => {
                  setForm((current) => ({ ...current, customQuestionInput: event.target.value }));
                  setErrors((current) => ({ ...current, customQuestionInput: "" }));
                }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomRequirement(); } }} placeholder="e.g. Which pages should your website include?" aria-describedby={errors.customQuestionInput ? "service-custom-requirement-error" : undefined} />
                <button className="market-button market-button-outline" type="button" onClick={addCustomRequirement}><Plus size={14} /> Add</button>
              </div>
              <ServiceFieldError id="service-custom-requirement-error">{errors.customQuestionInput}</ServiceFieldError>
              {form.customRequirements.length > 0 && (
                <ul className="seller-service-custom-list">
                  {form.customRequirements.map((question) => (
                    <li key={question}><span>{question}</span><button type="button" onClick={() => setForm((current) => ({ ...current, customRequirements: current.customRequirements.filter((item) => item !== question) }))} aria-label={`Remove requirement ${question}`}><Trash2 size={13} /></button></li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="seller-form-card seller-service-section seller-service-publish-section">
            <header className="seller-form-card-heading">
              <span className="seller-form-step-number">05</span>
              <div><h2>Review and publish</h2><p>Review the customer preview before saving your service.</p></div>
            </header>
            <div className="seller-service-publish-actions">
              <button className="market-button market-button-outline" type="submit" value="draft"><Save size={15} /> Save as Draft</button>
              <button className="market-button market-button-primary" type="submit" value="published">Publish Service <ArrowRight size={15} /></button>
            </div>
            <p className="seller-service-publish-note">Publishing only makes this service visible in your current browser session. It is not permanently saved or available to other visitors.</p>
          </section>
        </form>

        <aside className="seller-service-preview">
          <span className="market-eyebrow">CUSTOMER PREVIEW</span>
          <h2>{form.title || "Your service title"}</h2>
          <span className="seller-service-preview-category">{selectedCategory?.name || "Choose a category"}</span>
          <div className="seller-service-preview-image">
            {currentImage ? <img src={currentImage.url} alt={form.title || "Service preview"} /> : <div><FileImage size={24} /><span>Your main image preview</span></div>}
            {currentImage && <span>Main thumbnail</span>}
          </div>
          {images.length > 1 && <div className="seller-service-preview-thumbnails">{images.map((image, index) => <button key={image.id} type="button" className={mainImageIndex === index ? "active" : ""} onClick={() => setMainImageIndex(index)} aria-label={`Preview image ${index + 1}`}><img src={image.url} alt="" /></button>)}</div>}
          <div className="seller-service-preview-seller">
            <span>{sellerAvatar ? <img src={sellerAvatar} alt="" /> : sellerProfile.displayName.slice(0, 1).toUpperCase()}</span>
            <div><small>Seller preview</small><strong>{sellerProfile.displayName}</strong></div>
          </div>
          <p className="seller-service-preview-description">{form.description || "Your service description will appear here so customers can understand what you offer."}</p>
          {parsedTechnologies.length > 0 && <div className="seller-service-chip-list">{parsedTechnologies.map((technology) => <span key={technology}>{technology}</span>)}</div>}
          <h3>Packages</h3>
          <div className="seller-service-preview-packages">
            {enabledPackages.length > 0 ? enabledPackages.map((packageOption) => (
              <article key={packageOption.id}>
                <div><strong>{packageOption.name || "Package"}</strong><b>PKR {currency.format(Number(packageOption.price) || 0)}</b></div>
                <p>{packageOption.description || "Package description"}</p>
                <span><Clock3 size={12} /> {packageOption.deliveryDays || "—"} days · {packageOption.pages || "—"} pages · {packageOption.revisions || "—"} revisions</span>
              </article>
            )) : <p className="seller-service-preview-empty">Enable a package to show pricing here.</p>}
          </div>
          {form.requirements.length + form.customRequirements.length > 0 && (
            <>
              <h3>Customers should prepare</h3>
              <ul className="seller-service-preview-requirements">{form.requirements.concat(form.customRequirements).map((item) => <li key={item}><Check size={12} /> {item}</li>)}</ul>
            </>
          )}
          <div className="seller-service-preview-disclaimer">Preview only · Seller-entered details have not been saved to a server.</div>
        </aside>
      </div>
    </main>
  );
}
