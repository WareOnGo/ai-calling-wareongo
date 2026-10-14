"use client";
import { useEffect, useState, type ReactNode } from 'react';
import { dateTime, resultClass } from '@/lib/display';
import { elapsedTime } from '@/lib/time';
import type { AiAttempt, AiHistory } from '@/lib/ai-attempts';
import { requestJson } from './requests';
import { useDashboardUI } from './DashboardUI';
import { ResultBadge } from './ResultBadge';
import { Transcript } from './Transcript';

export function AiTimeline({ entity, id, initialOpen = false, initialBatch = '', initialScope, initialPhone, children }: {
  initialBatch?: string; initialScope?: 'contact' | 'execution'; initialPhone?: string | null;
  entity: 'record' | 'call'; id: string; initialOpen?: boolean; children?: ReactNode;
}) {
  const { isAdmin } = useDashboardUI();
  const [open, setOpen] = useState(initialOpen);
  const [scope, setScope] = useState(initialScope || (entity === 'record' || isAdmin ? 'contact' : 'execution'));
  const [batch, setBatch] = useState(initialBatch), [draft, setDraft] = useState(initialBatch);
  const digits = initialPhone?.replace(/\D/g, '').slice(-10);
  const [phone, setPhone] = useState(digits?.length === 10 ? digits : '');
  const [page, setPage] = useState(1), [data, setData] = useState<AiHistory | null>(null);
  const [phones, setPhones] = useState<string[]>([]);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setData(null); setError('');
    const params = new URLSearchParams({ scope, batch, phone, page: String(page) });
    requestJson<AiHistory>(`/api/details/${entity}/${id}/ai?${params}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setData(value); setPhones(value.phones); } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [entity, id, scope, batch, phone, page, open, retry]);

  return <section className="ai-timeline" aria-label="AI call history">
    <div className="history-heading"><h3>AI calls{data && <span className="history-count" aria-label={`${data.total} ${data.total === 1 ? 'call' : 'calls'}`}>{data.total}</span>}</h3>
      {open && <div className="history-heading-actions"><span>Newest first</span><button type="button" className="history-options-button" aria-label="History options" title="History options" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(value => !value)}><svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="14" cy="9" r="1.5"/></svg>{batch && <span className="history-filter-dot"/>}</button></div>}
    </div>
    {!open ? <button type="button" className="btn-row" onClick={() => setOpen(true)}>Load AI attempt history</button> : <>
      {optionsOpen && <div className="history-options-panel">
        <form className="history-filters" onSubmit={event => { event.preventDefault(); setBatch(draft.trim()); setPage(1); setOptionsOpen(false); }}>
          {entity === 'call' && isAdmin && <label>Show calls <select aria-label="AI history scope" value={scope} onChange={e => { setScope(e.target.value === 'contact' ? 'contact' : 'execution'); setPage(1); }}><option value="contact">All calls for this number</option><option value="execution">This execution only</option></select></label>}
          <label>Provider batch <input aria-label="AI history batch" value={draft} onChange={e => setDraft(e.target.value)} placeholder="All batches" maxLength={1000}/></label><button type="submit" className="btn-row">Filter AI history</button>
        </form>
        {data && <p className="history-scope">{data.outbound} outbound · {data.inbound} inbound · {data.conversations} confirmed {data.conversations === 1 ? 'conversation' : 'conversations'}{data.total > data.outbound + data.inbound && <> · {data.total - data.outbound - data.inbound} unknown direction</>}</p>}
        <details className="history-about"><summary>How calls are counted</summary><p>Calls shared across listings are grouped by phone number. Each provider call appears once; repeat calls remain separate. Known provider calls only. Older overwritten attempts and missing provider IDs cannot be reconstructed from totals. Conversation counts require finalized duration and caller speech evidence.</p>{!!data?.unknownExecutions && <p>{data.unknownExecutions} execution {data.unknownExecutions === 1 ? 'record has' : 'records have'} no identifiable provider attempt.</p>}</details>
        {children && <details className="history-saved" open={savedOpen} onToggle={event => setSavedOpen(event.currentTarget.open)}><summary>Saved record details</summary>{children}</details>}
      </div>}
      {batch && <div className="history-active-filter"><span>Batch: {batch}</span><button type="button" className="btn-text" onClick={() => { setBatch(''); setDraft(''); setPage(1); }}>Clear batch filter</button></div>}
      {phones.length > 1 && <label className="history-phone">History for <select aria-label="AI history phone number" value={phone} onChange={e => { setPhone(e.target.value); setPage(1); }}><option value="">All linked numbers</option>{phones.map(number => <option key={number} value={number}>+91{number}</option>)}</select></label>}
      {scope === 'execution' && <p className="history-restriction">This execution only</p>}
      {error ? <p role="alert">{error} <button type="button" className="btn-row" onClick={() => setRetry(n => n + 1)}>Retry AI history</button></p> : !data ? <p role="status" className="history-loading">Loading AI calls…</p> : <>
        {data.rows.length ? <ol className="attempt-list" aria-label="AI call timeline">{data.rows.map(event => <li className={`attempt-item attempt-${event.availability ? resultClass(event.availability) : 'unknown'}`} key={`${event.execution_id}:${event.provider_call_id}`}><span className="attempt-dot" aria-hidden="true"/><CallEvent event={event} showPhone={!data.phone && data.phones.length > 1}/></li>)}</ol> : <div className="history-empty"><p>{batch ? 'No AI calls match this batch.' : 'No recorded AI calls for this number.'}</p>{children && !batch && <button type="button" className="btn-text" onClick={() => { setOptionsOpen(true); setSavedOpen(true); }}>View saved record details</button>}</div>}
        {data.pages > 1 && <nav className="history-pagination" aria-label="AI attempt pages"><button type="button" className="btn-row" disabled={data.page <= 1} onClick={() => setPage(p => p - 1)}>Previous AI attempts</button><span>Page {data.page} of {data.pages}</span><button type="button" className="btn-row" disabled={data.page >= data.pages} onClick={() => setPage(p => p + 1)}>Next AI attempts</button></nav>}
      </>}
    </>}
  </section>;
}

function CallEvent({ event, showPhone }: { event: AiAttempt; showPhone: boolean }) {
  const [audioFailed, setAudioFailed] = useState(false);
  const direction = event.direction === 'outbound' ? 'Outbound' : event.direction === 'inbound' ? 'Inbound' : 'Direction unknown';
  const status = event.status ? event.status.replaceAll('-', ' ').replace(/^./, value => value.toUpperCase()) : 'Unknown status';
  const longNotes = (event.notes?.length || 0) > 220;
  const duration = event.duration_seconds === null ? null : elapsedTime(Number(event.duration_seconds));
  return <article className="attempt-card">
    <div className="attempt-heading">{event.availability ? <ResultBadge value={event.availability}/> : <strong>{status}</strong>}<span className="attempt-time">{event.initiated_at ? <time dateTime={event.initiated_at}>{dateTime(event.initiated_at)}</time> : 'Time not recorded'}</span></div>
    <p className="attempt-meta">{[direction, duration, event.agent_label ? `${event.agent_label} agent` : null, showPhone && event.phone_last10 ? `+91${event.phone_last10}` : null].filter(Boolean).join(' · ')}</p>
    {event.notes && <p className="attempt-notes">{longNotes ? `${event.notes.slice(0, 217).trim()}…` : event.notes}</p>}
    {event.recording_url && <div className="attempt-recording"><audio aria-label="Call recording" controls preload="none" src={event.recording_url} onError={() => setAudioFailed(true)}/>{audioFailed && <p role="alert">Couldn't play this recording. <a href={event.recording_url} target="_blank" rel="noreferrer">Open recording</a></p>}</div>}
    <div className="attempt-actions">
      {event.transcript && <details className="attempt-transcript"><summary>Transcript</summary><Transcript text={event.transcript}/></details>}
      <details className="attempt-info"><summary>Call info</summary><div className="attempt-info-content">
        {longNotes && <><h4>AI notes</h4><p className="detail-text">{event.notes}</p></>}
        <dl className="attempt-provider-facts"><div><dt>Connection</dt><dd>{status}</dd></div><div><dt>Conversation</dt><dd>{event.confirmed_conversation ? 'Confirmed' : 'Not confirmed'}</dd></div>
          {event.interval_seconds !== null && <div><dt>Since prior call</dt><dd>{elapsedTime(Number(event.interval_seconds))}</dd></div>}
          <div><dt>Provider call</dt><dd>{event.provider_call_id}</dd></div><div><dt>Execution</dt><dd>{event.execution_id}</dd></div>
          <div><dt>Provider</dt><dd>{event.provider || 'Not supplied'}</dd></div><div><dt>Batch</dt><dd>{event.batch_id || 'Not supplied'}</dd></div>
          <div><dt>Agent</dt><dd>{event.agent_label || event.agent_id || 'Not supplied'}</dd></div><div><dt>Execution created</dt><dd>{dateTime(event.execution_created_at)}</dd></div><div><dt>First observed</dt><dd>{dateTime(event.first_observed_at)}</dd></div>
        </dl>
      </div></details>
    </div>
  </article>;
}
