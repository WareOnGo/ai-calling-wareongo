"use client";

import { useState } from "react";
import { indiaDate } from "@/lib/callyzer";

export function CallerLinkEditor({ email, number, since, disabled, save }: {
  email: string; number?: string | null; since?: string | null; disabled: boolean;
  save: (body: Record<string,unknown>, key: string) => Promise<boolean>;
}) {
  const [phone,setPhone] = useState(number || "");
  const [start,setStart] = useState(since ? indiaDate(since) : indiaDate(new Date(Date.now()-30*86400000)));
  return <details className="person-callyzer"><summary>{number ? `Callyzer · ${number}` : "Manual only · Link Callyzer"}</summary>
    <form onSubmit={async event => { event.preventDefault(); await save({ email,callyzer_number: phone.trim() || null,callyzer_since: phone.trim() ? start : null },email); }}>
      <fieldset disabled={disabled} className="plain-fieldset callyzer-link-fields">
        <label className="fld"><span>Callyzer number</span><input aria-label={`Callyzer number for ${email}`} value={phone} onChange={e => setPhone(e.target.value)} placeholder="91-9876543210" autoComplete="off" maxLength={30}/></label>
        <label className="fld"><span>Attribute calls from (IST)</span><input aria-label={`Callyzer tracking date for ${email}`} type="date" value={start} max={indiaDate(new Date())} required={!!phone.trim()} onChange={e => setStart(e.target.value)}/></label>
        <button className="btn secondary" type="submit">Save caller link</button>
        {number && <button className="btn-text" type="button" onClick={async () => { if (await save({ email,callyzer_number: null,callyzer_since: null },email)) setPhone(""); }}>Unlink</button>}
      </fieldset>
      <p className="team-coverage-note">Use the number registered in Callyzer, including its country code. The date decides which unattributed calls belong to this caller. Existing attributed history is kept when a link changes. Callers without Callyzer can continue recording outcomes manually.</p>
    </form>
  </details>;
}
