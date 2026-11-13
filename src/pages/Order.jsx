import { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { formatPrice, templates } from "../data/templates.js";

export default function Order() {
  const { id } = useParams();
  const template = templates.find((item) => item.id === id);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", business: "", notes: "" });
  const [errors, setErrors] = useState({});

  if (!template) return <main className="simple-page"><h1>Template not found</h1><Link to="/templates">Back to templates</Link></main>;

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
  };

  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) nextErrors.email = "Please enter a valid email address.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) setSubmitted(true);
  };

  if (submitted) {
    return (
      <main className="order-page">
        <div className="order-success">
          <span className="success-icon"><CheckCircle2 size={26} /></span><span className="eyebrow">A lovely place to begin</span>
          <h1>Thanks, {form.name.split(" ")[0]}.</h1>
          <p>Your enquiry for <strong>{template.name}</strong> is in. We’ll be in touch at <strong>{form.email}</strong> with the next steps.</p>
          <Link className="button button-primary" to="/templates">Back to the collection <ArrowRight size={15} /></Link>
        </div>
      </main>
    );
  }

  return (
    <main className="order-page section">
      <Link to={`/templates/${template.id}`} className="back-link"><ArrowLeft size={14} /> Back to {template.name}</Link>
      <div className="order-layout">
        <div className="order-form-side">
          <span className="eyebrow"><Sparkles size={13} /> ONE GOOD IDEA, COMING UP</span>
          <h1>Let’s make it<br /><span className="gradient-text">yours.</span></h1>
          <p>Leave us a few details and we’ll be in touch to help get your new template into your hands.</p>
          <form className="order-form" onSubmit={submit} noValidate>
            <label htmlFor="order-name">Your name <span>*</span></label>
            <input id="order-name" name="name" autoComplete="name" placeholder="How should we say hello?" value={form.name} onChange={update} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} />
            {errors.name && <span className="form-error" id="name-error">{errors.name}</span>}
            <label htmlFor="order-email">Email address <span>*</span></label>
            <input id="order-email" name="email" type="email" autoComplete="email" placeholder="you@somewhere.com" value={form.email} onChange={update} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} />
            {errors.email && <span className="form-error" id="email-error">{errors.email}</span>}
            <label htmlFor="order-business">Your project or business <span className="optional">(optional)</span></label>
            <input id="order-business" name="business" placeholder="Tell us a little about it" value={form.business} onChange={update} />
            <label htmlFor="order-notes">Anything else we should know? <span className="optional">(optional)</span></label>
            <textarea id="order-notes" name="notes" rows="3" placeholder="A thought, a question, a big idea..." value={form.notes} onChange={update} />
            <button type="submit" className="button button-primary order-submit">Send your enquiry <ArrowRight size={15} /></button>
            <span className="privacy-note"><LockKeyhole size={12} /> Just between us. Your details stay private.</span>
          </form>
        </div>
        <aside className="order-summary">
          <span className="eyebrow">A good starting point</span>
          <div className={`order-summary-art template-art-${template.style}`}><span className="summary-mark">{template.initials}</span><span className="summary-art-name">{template.name}</span><span className="summary-art-caption">{template.category.toUpperCase()} · MADE WITH INTENTION</span></div>
          <div className="summary-title"><span>{template.name}</span><span>{formatPrice(template.price)}</span></div>
          <p>One-time payment <span>·</span> Yours to make your own</p>
          <div className="summary-includes">{template.features.slice(0, 3).map((feature) => <span key={feature}><CheckCircle2 size={13} /> {feature}</span>)}</div>
          <div className="summary-foot"><Sparkles size={13} /> A thoughtful start to something good.</div>
        </aside>
      </div>
    </main>
  );
}
