import type { ReactNode } from "react";
import { CopyText } from "./CopyText";
import { RecordDetails } from "./RecordDetails";

type ContactDetails = {
  id: string;
  entity: "record" | "call";
  aiBatch?: string;
  aiScope?: "contact" | "execution";
};

// A full-card native button sits behind the contents. Copy remains a sibling
// control above it, so there are no nested buttons or competing click handlers.
export function ContactCard({ name, phone, nameDisplay, phoneDisplay, details, metadata }: {
  name: string | null | undefined;
  phone: string | null | undefined;
  nameDisplay?: ReactNode;
  phoneDisplay?: ReactNode;
  details?: ContactDetails;
  metadata?: ReactNode;
}) {
  const contactName = name?.trim() || "Unnamed contact";
  return <div className={`contact-card${details ? " contact-card-interactive" : ""}`}>
    {details && <RecordDetails {...details} className="contact-card-open details-trigger" title={`Open details for ${contactName}`}>
      <span className="sr-only">Open details for {contactName}</span>
    </RecordDetails>}
    <div className="contact-card-content">
      <strong className="contact-card-name" title={contactName}>{name?.trim() ? nameDisplay ?? name : contactName}</strong>
      <div className="contact-card-phone">
        {phone?.trim() ? <CopyText value={phone} display={phoneDisplay} label="phone number" /> : <span className="muted">No phone number</span>}
      </div>
      {metadata && <div className="contact-card-meta record-meta">{metadata}</div>}
    </div>
    {details && <ContactArrow />}
  </div>;
}

function ContactArrow() {
  return <svg className="contact-card-arrow" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>;
}

export function ContactCardSkeleton({ metadata = false }: { metadata?: boolean }) {
  return <div className="contact-card" aria-hidden="true">
    <div className="contact-card-content">
      <span className="contact-card-name"><span className="skeleton" style={{ width: "75%", height: 14 }}/></span>
      <div className="contact-card-phone"><span className="skeleton" style={{ width: 135, height: 14 }}/></div>
      {metadata && <div className="contact-card-meta record-meta"><span className="skeleton" style={{ width: "85%", height: 12 }}/></div>}
    </div>
    <ContactArrow />
  </div>;
}
