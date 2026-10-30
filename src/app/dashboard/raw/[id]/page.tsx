import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { area, dateTime } from "@/lib/display";
import { CopyText } from "../../CopyText";
import { RecordDetails } from "../../RecordDetails";
import styles from "./record.module.css";

export const dynamic = "force-dynamic";

type LeadRecord = {
  id: string; owner_name: string | null; phone: string | null;
  ingested_at: string;
  city: string | null; state: string | null; address: string | null;
  area_sqft: string | null; listing_status: string | null;
  execution_id: string | null; from_number: string | null;
  to_number: string | null; call_type: string | null;
  initiated_at: string | null; call_created_at: string | null;
};

export default async function LeadRecordPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const { rows } = await query<LeadRecord>(`select r.id, r.owner_name, r.ingested_at::text,
    r.city, r.state, r.address, r.area_sqft::text, r.listing_status,
    (select p.phone from raw_phones rp join raw_phone_numbers p using(phone_id)
      where rp.master_id=r.id and nullif(trim(p.phone),'') is not null
      order by rp.is_primary desc, rp.phone_id limit 1) as phone,
    c.id as execution_id, c.from_number, c.to_number, c.call_type,
    c.initiated_at, c.call_created_at::text
    from raw_records r left join lateral (
      select cl.id, cl.from_number, cl.to_number, cl.call_type,
        cl.raw->>'initiated_at' as initiated_at, cl.call_created_at
      from raw_phones rp join bolna_call_logs cl using(phone_id)
      where rp.master_id=r.id
      order by cl.call_created_at desc nulls last, cl.id desc limit 1
    ) c on true where r.id=$1::uuid`, [id]);
  const lead = rows[0];
  if (!lead) notFound();
  const outbound = lead.call_type === "outbound";
  return <main className={styles.page}>
    <div className={styles.toolbar}><Link href={`/dashboard/raw?q=${encodeURIComponent(lead.phone || lead.owner_name || "")}`}>← Raw Dataset</Link><span>CRM lead record</span></div>
    <header className={styles.identity}>
      <div><p className={styles.eyebrow}>WareOnGo · Lead details</p><h1>{lead.owner_name || "Unnamed contact"}</h1><p className={styles.phone}><CopyText value={lead.phone} label="lead phone number"/></p></div>
      <RecordDetails id={lead.id} entity="record" label="View activity" className="btn-row" initialSection="AI activity"/>
    </header>
    <div className={styles.grid}>
      <section className={styles.card} aria-label="CRM lead details">
        <h2>CRM lead details</h2>
        <dl className={styles.facts}>
          <div className={styles.highlight}><dt>CRM imported on</dt><dd><time dateTime={lead.ingested_at}>{dateTime(lead.ingested_at)}</time></dd></div>
          <div className={styles.wide}><dt>Contact name</dt><dd>{lead.owner_name || "—"}</dd></div>
          <div className={styles.wide}><dt>Lead phone number</dt><dd><CopyText value={lead.phone} label="CRM phone number"/></dd></div>
          <div className={styles.wide}><dt>Location</dt><dd>{[lead.city, lead.state].filter(Boolean).join(", ") || "—"}</dd></div>
        </dl>
      </section>
      <section className={styles.card} aria-label="Latest linked call">
        <h2>Latest linked call</h2>
        {lead.execution_id ? <dl className={styles.facts}>
          <div className={styles.highlight}><dt>{outbound ? "Called from (DID)" : "Receiving DID"}</dt><dd><CopyText value={outbound ? lead.from_number : lead.call_type === "inbound" ? lead.to_number : null} label="DID number"/></dd></div>
          <div className={styles.wide}><dt>{outbound ? "Called number" : "Calling number"}</dt><dd><CopyText value={outbound ? lead.to_number : lead.from_number} label="call contact number"/></dd></div>
          <div className={styles.wide}><dt>{lead.initiated_at ? "Call initiated at" : "Execution created at"}</dt><dd>{dateTime(lead.initiated_at || lead.call_created_at)}</dd></div>
          <div><dt>Direction</dt><dd>{outbound ? "Outbound" : lead.call_type === "inbound" ? "Inbound" : "Not recorded"}</dd></div>
        </dl> : <p>No linked AI call recorded.</p>}
      </section>
      <section className={`${styles.card} ${styles.property}`} aria-label="Property details">
        <h2>Property details</h2><dl className={styles.facts}>
          <div><dt>Location</dt><dd>{[lead.city, lead.state].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt>Listed area</dt><dd>{area(lead.area_sqft)}</dd></div>
          <div><dt>Listing status</dt><dd>{lead.listing_status || "—"}</dd></div>
        </dl>
      </section>
    </div>
    {lead.execution_id && <footer className={styles.footer}><span>Call execution ID: {lead.execution_id}</span></footer>}
  </main>;
}
