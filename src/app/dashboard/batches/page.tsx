import Link from 'next/link';
import {requireAdmin} from '@/lib/auth';
import {listBatches,batchListSchema} from '@/lib/batch-browser';
import {firstValue,searchQuery,type SearchValues} from '@/lib/filter-values';
import {dateTime} from '@/lib/display';
import {agentLabel} from '@/lib/agents';
import {listUsers} from '@/lib/users';
import {PageJump} from '../PageJump';
import {WalletBalance} from '../WalletBalance';
import {Freshness} from '../DashboardUI';
export const dynamic='force-dynamic';
export default async function Batches({searchParams}:{searchParams:Promise<SearchValues>}){
 const viewer=await requireAdmin(),sp=await searchParams;
 const parsed=batchListSchema.safeParse(Object.fromEntries(Object.entries(sp).map(([k,v])=>[k,firstValue(v)]).filter(([,v])=>v)));
 if(!parsed.success)return <p role="alert">Invalid batch filters. <Link href="/dashboard/batches">Clear filters</Link></p>;
 const f=parsed.data,[data,people]=await Promise.all([listBatches(viewer,f,Number(firstValue(sp.page)||1)),listUsers()]);
 const href=(page:number)=>`?${searchQuery({...sp,page:String(page)})}`;
 return <>
  <div className="page-title">Batches <Freshness updatedAt={new Date().toISOString()}/></div>
  <nav className="batch-tabs" aria-label="Batch type"><Link href="/dashboard/batches?kind=ai" aria-current={f.kind==='ai'?'page':undefined}>AI batches</Link><Link href="/dashboard/batches?kind=manual" aria-current={f.kind==='manual'?'page':undefined}>Manual batches</Link></nav>
  {f.kind==='ai'&&<WalletBalance/>}
  <form className="filterbar batch-filters" method="GET"><input type="hidden" name="kind" value={f.kind}/>
   <label>From <input type="date" name="date_from" defaultValue={f.date_from}/></label><label>To <input type="date" name="date_to" defaultValue={f.date_to}/></label>
   <label>{f.kind==='manual'?'Caller':'Created by'} <select name="caller" defaultValue={f.caller||''}><option value="">Anyone</option>{people.map(p=><option value={p.email} key={p.email}>{p.name||p.email}</option>)}</select></label>
   {f.kind==='manual'?<label>Origin <select name="origin" defaultValue={f.origin||''}><option value="">Both origins</option><option value="record">Raw Dataset</option><option value="call">Calls</option></select></label>:<><label>Agent ID <input name="agent" defaultValue={f.agent}/></label><label>Dispatch ID <input name="dispatch" defaultValue={f.dispatch}/></label></>}
   <label>State <select name="state" defaultValue={f.state||''}><option value="">All states</option>{(f.kind==='manual'?['open','closed']:['creating','scheduling','scheduled','uncertain','completed','canceled','failed','stubbed']).map(v=><option key={v}>{v}</option>)}</select></label>
   <button className="btn" type="submit">Filter batches</button><Link className="btn-text" href={`/dashboard/batches?kind=${f.kind}`}>Reset</Link>
  </form>
  <p>{data.total} matching {f.kind==='ai'?'AI':'manual'} batches · Dates use IST. <a href={`/api/batches/export?${searchQuery({...sp,kind:f.kind},['page'])}`}>Export batch list</a></p>
  {f.kind==='manual'&&<p><Link href="/dashboard/batches/manual/legacy">Legacy / no recorded batch ({data.legacy} assignments)</Link></p>}
  <div className="batch-catalog">{data.rows.map(b=><article className="detail-history" key={b.id}>
   <h2><Link href={`/dashboard/batches/${b.kind}/${b.id}`}>{b.kind==='manual'?'Manual':'AI'} batch {b.id.slice(0,8)}</Link></h2>
   <p>{b.state} · {b.kind==='ai'?agentLabel(b.agent_id,b.agent_language):b.entity_type==='record'?'From Raw Dataset':'From Calls'} · {dateTime(b.created_at)}</p>
   <p>{b.created_by} {b.assignees?`· Callers: ${b.assignees.join(', ')}`:''}</p>
   {b.dispatch_request_id&&<p>Dispatch <Link href={`?kind=ai&dispatch=${b.dispatch_request_id}`}>{b.dispatch_request_id}</Link> · language {b.agent_language||'Unknown'}</p>}
   {b.scheduled_at&&<p>Scheduled: {dateTime(b.scheduled_at)}</p>}{b.last_error&&<p className="row-error">{b.last_error}</p>}
  </article>)}{!data.rows.length&&<p>No batches match these filters.</p>}</div>
  <nav className="pager" aria-label="Batch pages">{data.page>1&&<Link href={href(data.page-1)}>Previous</Link>}<span>Page {data.page}/{data.pages}</span>{data.page<data.pages&&<Link href={href(data.page+1)}>Next</Link>}</nav>
  <PageJump key={data.page} page={data.page} pages={data.pages}/>
 </>;
}
