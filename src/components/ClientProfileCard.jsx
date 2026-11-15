import { UserRound } from "lucide-react";

export function ClientProfileCard({ icon: Icon, title, description, action, children, className = "" }) {
  return (
    <section className={`client-profile-card ${className}`.trim()}>
      <header className="client-profile-card-heading">
        <span className="client-profile-card-icon"><Icon size={18} aria-hidden="true" /></span>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="client-profile-card-action">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export function ClientProfileDetail({ icon: Icon = UserRound, label, value }) {
  return (
    <div className="client-profile-detail">
      <span className="client-profile-detail-icon"><Icon size={16} aria-hidden="true" /></span>
      <div>
        <span className="client-profile-detail-label">{label}</span>
        <strong>{value || "Not provided"}</strong>
      </div>
    </div>
  );
}

export function ClientProfileInput({ id, label, ...inputProps }) {
  return (
    <label className="client-profile-form-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} {...inputProps} />
    </label>
  );
}
