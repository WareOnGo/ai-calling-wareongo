import Link from 'next/link';
import {requireAdmin} from '@/lib/auth';
import {listBatches,batchListSchema,batchProgress} from '@/lib/batch-browser';
import {firstValue,searchQuery,type SearchValues} from '@/lib/filter-values';
import {dateTime} from '@/lib/display';
import {agentLabel} from '@/lib/agents';
import {listUsers} from '@/lib/users';
import {RecordsPagination} from '../RecordsPagination';
import {RecordsHeader} from '../RecordsHeader';
import {WalletBalance} from '../WalletBalance';
import {Freshness} from '../DashboardUI';
import {BatchStatus} from './BatchStatus';
import {BatchLiveUpdates} from './BatchLiveUpdates';
import {BatchFilters} from './BatchFilters';
export const dynamic='force-dynamic';

export default async function Batches({searchParams}:{searchParams:Promise<SearchValues>}){
 const viewer=await requireAdmin(),sp=await searchParams;
 const parsed=batchListSchema.safeParse(Object.fromEntries(Object.entries(sp).filter(([,v])=>v)));
 if(!parsed.success)return <p role="alert">Invalid batch filters. <Link href="/dashboard/batches">Clear filters</Link></p>;
 const f=parsed.data,[data,people]=await Promise.all([listBatches(viewer,f,Number(firstValue(sp.page)||1)),listUsers()]);
 const progress=await batchProgress(data.rows),active=data.rows.filter(b=>b.kind==='ai'&&!['completed','canceled','stubbed'].includes(b.state)).map(b=>b.id);
 return <>
  <RecordsHeader title="Batches" meta={f.kind==='ai'?<WalletBalance compact/>:undefined} actions={<><BatchLiveUpdates ids={active}/><Freshness updatedAt={new Date().toISOString()}/></>}
   tabs={<nav className="batch-tabs" aria-label="Batch type"><Link href="/dashboard/batches?kind=ai" aria-current={f.kind==='ai'?'page':undefined}>AI batches</Link><Link href="/dashboard/batches?kind=manual" aria-current={f.kind==='manual'?'page':undefined}>Manual batches</Link></nav>}/>
  <BatchFilters applied={sp} kind={f.kind} people={people} />
  <div className="batch-results-heading"><span>{data.total.toLocaleString()} matching {f.kind==='ai'?'AI':'manual'} batches <small>Dates use IST</small></span><a href={'/api/batches/export?'+searchQuery({...sp,kind:f.kind},['page'])}>Export batch list</a></div>
  {f.kind==='manual'&&<p className="batch-legacy"><Link href="/dashboard/batches/manual/legacy">Legacy / no recorded batch ({data.legacy} assignments)</Link></p>}
  <div className="batch-catalog">{data.rows.map(b=>{
    const counts=progress[b.id]||{targeted:0,finished:0,attempts:0},path='/dashboard/batches/'+b.kind+'/'+b.id;
    return <article className="batch-card" key={b.id}>
     <div className="batch-card-heading"><h2><Link href={path}>{b.kind==='manual'?'Manual':'AI'} batch {b.id.slice(0,8)}</Link></h2><BatchStatus state={b.state} received={counts.finished} total={counts.targeted}/></div>
     <p className="batch-card-context">{b.kind==='ai'?agentLabel(b.agent_id,b.agent_language):b.entity_type==='record'?'From Raw Dataset':'From Calls'}</p>
     <div className="batch-card-progress"><span><strong>{counts.finished.toLocaleString()}</strong> of {counts.targeted.toLocaleString()} {b.kind==='ai'?'contacts have results':'records completed'}</span><progress aria-label={b.kind==='ai'?'Contacts with results':'Completed records'} max={Math.max(1,counts.targeted)} value={counts.finished}/></div>
     <dl className="batch-card-facts"><div><dt>Created</dt><dd>{dateTime(b.created_at)}</dd></div>{b.scheduled_at&&<div><dt>Scheduled</dt><dd>{dateTime(b.scheduled_at)}</dd></div>}<div><dt>Created by</dt><dd>{b.created_by||'Unknown'}</dd></div>{b.assignees&&<div><dt>Callers</dt><dd>{b.assignees.join(', ')}</dd></div>}</dl>
     <div className="batch-card-foot"><span>{counts.attempts.toLocaleString()} {b.kind==='ai'?'known AI attempts':'manual attempts'}</span><Link href={path}>View {b.kind==='ai'?'contacts':'records'} →</Link></div>
     {(b.dispatch_request_id||b.last_error)&&<details className="batch-card-references"><summary>{b.last_error?'Status needs attention':'Batch references'}</summary>{b.dispatch_request_id&&<p>Dispatch <Link href={'?kind=ai&dispatch='+b.dispatch_request_id}>{b.dispatch_request_id}</Link></p>}{b.last_error&&<p className="row-error">{b.last_error}</p>}</details>}
    </article>;
  })}{!data.rows.length&&<p className="batch-empty">No batches match these filters.</p>}</div>
  <RecordsPagination page={data.page} pages={data.pages} total={data.total} pageSize={25} applied={sp} empty="No batches" label="Batch pages"/>
 </>;
}
