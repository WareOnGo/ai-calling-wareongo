import { BatchMemberFilters } from "../../BatchMemberFilters";
import {allocationLabel} from "@/lib/manual-dispositions";
import Link from 'next/link';
import {ApiError} from '@/lib/api';
import {notFound} from 'next/navigation';
import {requireAdmin} from '@/lib/auth';
import {getBatch,batchMembers,batchMemberFiltersSchema,AI_CARDS,MANUAL_CARDS} from '@/lib/batch-browser';
import {firstValue,searchQuery,type SearchValues} from '@/lib/filter-values';
import {dateTime} from '@/lib/display';
import {ResultBadge} from '../../../ResultBadge';
import {agentLabel} from '@/lib/agents';
import {RecordDetails} from '../../../RecordDetails';
import {RecordsPagination} from '../../../RecordsPagination';
import {RecordsHeader} from '../../../RecordsHeader';
import {CopyText} from '../../../CopyText';
import {WalletBalance} from '../../../WalletBalance';
import {BatchResolution} from '../../../BatchActivity';
import {BatchStatus} from '../../BatchStatus';
import {BatchLiveUpdates} from '../../BatchLiveUpdates';
export const dynamic='force-dynamic';

export default async function BatchDetail({params,searchParams}:{params:Promise<{kind:string;id:string}>;searchParams:Promise<SearchValues>}){
 const viewer=await requireAdmin(),{kind,id}=await params,sp=await searchParams;if(kind!=='ai'&&kind!=='manual')notFound();
 let batch;try{batch=await getBatch(viewer,kind,id);}catch(error){if(error instanceof ApiError && error.status===404)notFound();throw error;}
 const parsed=batchMemberFiltersSchema.safeParse(Object.fromEntries(Object.entries(sp).filter(([,v])=>v)));
 if(!parsed.success)return <p role="alert">Invalid member filters. <Link href={'/dashboard/batches/'+kind+'/'+id}>Clear filters</Link></p>;
 const metric=firstValue(sp.metric)||'all';let data;try{data=await batchMembers(viewer,batch,metric,Number(firstValue(sp.page)||1),parsed.data);}catch(error){console.error("Batch members failed",{kind,id,error:error instanceof Error?error.name:"Unknown"});return <p role="alert">Could not load batch records. <Link href={'/dashboard/batches/'+kind+'/'+id}>Reset filters and retry</Link></p>;}
 const base='/dashboard/batches/'+kind+'/'+id,cards=kind==='ai'?AI_CARDS:MANUAL_CARDS;
 const groups=kind==='ai'?[{title:'Call progress',keys:['all','attempted','connected']},{title:'Latest results',keys:['available','unavailable','unclear']},{title:'Needs attention',keys:['pending','failure','blocked']}]:[{title:'Workload',keys:['all','assigned','open']},{title:'Outcomes',keys:['done','available','onboarded']},{title:'Follow-up & review',keys:['dropped','retry_due','connected','quality']}];
 const finished=kind==='ai'?data.metrics.all-data.metrics.pending:data.metrics.done;
 return <>
  <div className="batch-breadcrumb"><Link href={'/dashboard/batches?kind='+kind}>← Back to {kind==='ai'?'AI':'manual'} batches</Link></div>
  <RecordsHeader title={id==='legacy'?'Legacy / no recorded batch':(kind==='ai'?'AI':'Manual')+' batch '+id.slice(0,8)}
   meta={<p className="batch-lead">{id==='legacy'?'These assignments predate recorded batch membership.':<>{kind==='ai'?agentLabel(batch.agent_id,batch.agent_language):batch.entity_type==='record'?'From Raw Dataset':'From Calls'} · Created {dateTime(batch.created_at)}</>}</p>}
   actions={<><BatchStatus state={batch.state} received={finished} total={data.metrics.all}/><BatchLiveUpdates ids={kind==='ai'&&!['completed','canceled','stubbed'].includes(batch.state)?[id]:[]}/></>}/>
  <div className="batch-detail-tools">
   <details className="batch-metadata"><summary>Batch information</summary>
    <dl className="batch-info-facts"><div><dt>Created by</dt><dd>{batch.created_by||'Unknown'}</dd></div>{batch.scheduled_at&&<div><dt>Scheduled</dt><dd>{dateTime(batch.scheduled_at)}</dd></div>}{batch.assignees&&<div><dt>Original callers</dt><dd>{batch.assignees.join(', ')}</dd></div>}{batch.dispatch_request_id&&<div><dt>Parent dispatch</dt><dd><Link href={'/dashboard/batches?kind=ai&dispatch='+batch.dispatch_request_id}>{batch.dispatch_request_id}</Link></dd></div>}{batch.bolna_batch_id&&<div><dt>Provider batch</dt><dd><CopyText value={batch.bolna_batch_id} label="provider batch ID"/></dd></div>}</dl>
    {!!batch.selection&&<details><summary>Original selection</summary><pre className="batch-selection">{JSON.stringify(batch.selection,null,2)}</pre></details>}
    {batch.last_error&&<p className="row-error">{batch.last_error}</p>}{batch.resolution_note&&<p>Resolution: {batch.resolution_note}</p>}
    {id==='legacy'&&<p>Their timestamps do not prove that they were assigned together.</p>}
   </details>
   {batch.bolna_batch_id&&<Link className="btn-text" href={'/dashboard/calls?'+new URLSearchParams({batch_id:batch.bolna_batch_id,include_blocked:'1'})}>Open all execution records</Link>}
   {kind==='ai'&&!['completed','canceled'].includes(batch.state)&&<BatchResolution batch={batch}/>}
  </div>
  <div className="batch-metrics">{groups.map(group=><section className="batch-metric-group" key={group.title}><h2>{group.title}</h2><div>{cards.filter(([key])=>group.keys.includes(key)).map(([key,label])=><Link key={key} href={base+'?'+searchQuery({...sp,metric:key},['page'])} className={'stat'+(metric===key?' stat-active':'')} aria-current={metric===key?'true':undefined}><strong>{data.metrics[key].toLocaleString()}</strong><span>{label}</span></Link>)}</div></section>)}</div>
  <div className="batch-context-row"><span><strong>{data.metrics.attempts.toLocaleString()}</strong> {kind==='ai'?'known provider attempts':'recorded manual attempts'} across this batch</span><details><summary>How counts work</summary><p>Cards count {kind==='ai'?'unique targeted phone contacts using their latest execution result; attempts and conversations require provider evidence. Completion is confirmed with Bolna after pending calls and retries have finished.':'original membership records; completion requires the current quality checks. Membership is fixed at allocation. Original caller and current contact owner are shown separately. Onboarding is staff-recorded, with a valid WH reference.'}</p></details>{kind==='ai'&&<WalletBalance compact/>}</div>
  <BatchMemberFilters path={base} applied={sp} kind={kind} options={data.options} />
  <div className="batch-results-heading"><h2>{cards.find(([key])=>key===metric)?.[1]||'Contacts'} <span>{data.total.toLocaleString()} matching {kind==='ai'?'contacts':'records'}</span></h2><a href={'/api/batches/'+id+'/export?'+searchQuery({...sp,kind,metric},['page'])}>Export matching members</a></div>
  <div className="gridwrap batch-grid"><table className="sheet"><thead><tr className="colheads"><th>Contact</th><th>Phone</th>{kind==='manual'&&<><th>Original caller / current owner</th><th>Allocation</th></>}<th>{kind==='ai'?'Call status':'State'}</th><th>{kind==='ai'?'AI result':'Manual result'}</th><th>Recorded attempts</th><th>Details</th></tr></thead>
   <tbody>{data.rows.map(r=><tr key={r.member_id}><td><strong className="batch-contact-name">{r.name||'Unnamed'}</strong><span className="batch-contact-city">{r.city||'Unknown city'}</span></td><td><CopyText value={r.phone} label="phone number"/></td>{kind==='manual'&&<><td><span>{r.assignee||'Not assigned'}</span><span className="batch-contact-city">Now: {r.current_owner||'Unassigned'}</span></td><td>{allocationLabel(r.disposition)}</td></>}<td><span className="batch-call-state">{r.state}</span>{r.quality_issue&&<span className="review-tag">Needs completion review</span>}</td><td><ResultBadge value={r.outcome}/>{r.wh_id&&<small className="batch-contact-city">WH ID: {r.wh_id}</small>}</td><td><strong>{r.attempts}</strong>{r.connected&&<span className="batch-contact-city">Connected</span>}</td><td>{r.execution_id?<RecordDetails aiBatch={batch.bolna_batch_id||undefined} aiScope="contact" entity="call" id={r.execution_id} label="AI timeline"/>:r.entity_id&&/^[0-9a-f-]{36}$/i.test(r.entity_id)&&r.entity_type?<RecordDetails entity={r.entity_type} id={r.entity_id}/>:null}</td></tr>)}</tbody>
  </table>{!data.rows.length&&<p className="batch-empty">No batch members match these filters.</p>}</div>
  <RecordsPagination page={data.page} pages={data.pages} total={data.total} pageSize={50} applied={sp} empty="No matching members" label="Batch member pages"/>
 </>;
}
