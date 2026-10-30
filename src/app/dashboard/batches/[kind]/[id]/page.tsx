import { BatchMemberFilters } from "../../BatchMemberFilters";
import Link from 'next/link';
import {ApiError} from '@/lib/api';
import {notFound} from 'next/navigation';
import {requireAdmin} from '@/lib/auth';
import {getBatch,batchMembers,batchMemberFiltersSchema,AI_CARDS,MANUAL_CARDS,MANUAL_METRIC_DESCRIPTIONS} from '@/lib/batch-browser';
import {firstValue,searchQuery,type SearchValues} from '@/lib/filter-values';
import {dateTime} from '@/lib/display';
import {ResultBadge} from '../../../ResultBadge';
import {agentLabel} from '@/lib/agents';
import {RecordDetails} from '../../../RecordDetails';
import {ContactCard} from '../../../ContactCard';
import {RecordsPagination} from '../../../RecordsPagination';
import {RecordsHeader} from '../../../RecordsHeader';
import {CopyText} from '../../../CopyText';
import {WalletBalance} from '../../../WalletBalance';
import {BatchResolution} from '../../../BatchActivity';
import {BatchStatus} from '../../BatchStatus';
import {BatchLiveUpdates} from '../../BatchLiveUpdates';
import {ManualBatchCells} from '../../ManualBatchCells';
import {WarehouseNotice} from '../../../WarehouseNotice';
export const dynamic='force-dynamic';

export default async function BatchDetail({params,searchParams}:{params:Promise<{kind:string;id:string}>;searchParams:Promise<SearchValues>}){
 const viewer=await requireAdmin(),{kind,id}=await params,sp=await searchParams;if(kind!=='ai'&&kind!=='manual')notFound();
 let batch;try{batch=await getBatch(viewer,kind,id);}catch(error){if(error instanceof ApiError && error.status===404)notFound();throw error;}
 const parsed=batchMemberFiltersSchema.safeParse(Object.fromEntries(Object.entries(sp).filter(([,v])=>v)));
 if(!parsed.success)return <p role="alert">Invalid member filters. <Link href={'/dashboard/batches/'+kind+'/'+id}>Clear filters</Link></p>;
 const metric=firstValue(sp.metric)||'all';let data;try{data=await batchMembers(viewer,batch,metric,Number(firstValue(sp.page)||1),parsed.data);}catch(error){console.error("Batch members failed",{kind,id,error:error instanceof Error?error.name:"Unknown"});return <p role="alert">Could not load batch records. <Link href={'/dashboard/batches/'+kind+'/'+id}>Reset filters and retry</Link></p>;}
 const base='/dashboard/batches/'+kind+'/'+id,cards=kind==='ai'?AI_CARDS:MANUAL_CARDS;
 const groups=kind==='ai'?[{title:'Call progress',keys:['all','attempted','connected']},{title:'Latest results',keys:['available','unavailable','unclear']},{title:'Needs attention',keys:['pending','failure','blocked']}]:[{title:'Assignment progress',keys:['all','assigned','open']},{title:'Completion & DB records',keys:['done','quality','available','onboarded']},{title:'Call activity & ownership',keys:['connected','retry_due','dropped']}];
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
  <div className="batch-metrics">{groups.map(group=><section className="batch-metric-group" key={group.title}><h2>{group.title}</h2><div>{cards.filter(([key])=>group.keys.includes(key)).map(([key,label])=><Link key={key} href={base+'?'+searchQuery({...sp,metric:key},['page'])} className={'stat'+(metric===key?' stat-active':'')} aria-current={metric===key?'true':undefined} title={kind==='manual'?MANUAL_METRIC_DESCRIPTIONS[key]:undefined}><strong>{data.metrics[key].toLocaleString()}</strong><span>{label}</span></Link>)}</div></section>)}</div>
  <div className="batch-context-row"><span><strong>{data.metrics.attempts.toLocaleString()}</strong> {kind==='ai'?'known provider attempts':'recorded manual attempts'} across this batch</span><details><summary>How counts work</summary>{kind==='ai'?<p>Cards count unique targeted phone contacts using their latest execution result; attempts and conversations require provider evidence. Completion is confirmed with Bolna after pending calls and retries have finished.</p>:<><p>Counts cover records from the original batch selection. One record can appear in several counts, so these numbers do not add up to the batch total. Filters below change the table, not the batch counts.</p><p>Done · checks passed and Marked done · needs correction split assignments marked done by their saved completion details. Historical assignments can pass without a logged call. Available and Added to DB count recorded warehouse references, including older formats; they do not verify the external warehouse database.</p></>}</details>{kind==='ai'&&<WalletBalance compact/>}</div>
  <BatchMemberFilters path={base} applied={sp} kind={kind} options={data.options} />
  <div className="batch-results-heading"><div><h2>{cards.find(([key])=>key===metric)?.[1]||'Contacts'} <span>{data.total.toLocaleString()} matching {kind==='ai'?'contacts':'records'}</span></h2>{kind==='manual'&&metric!=='all'&&<p className="batch-metric-description">{MANUAL_METRIC_DESCRIPTIONS[metric]}</p>}</div></div>
  <div className={`gridwrap batch-grid${kind==='manual'?' batch-manual-grid':''}`}><table className="sheet"><thead><tr className="colheads"><th>Contact</th>{kind==='manual'?<><th className="batch-caller">Caller</th><th className="batch-assignment-status">Assignment status</th><th>Manual result</th><th className="batch-caller-notes">Caller notes</th><th className="batch-call-activity">Call activity</th></>:<><th>Call status</th><th>AI result</th><th>Recorded attempts</th></>}</tr></thead>
   <tbody>{data.rows.map(r => {
    const details = r.execution_id
      ? {id: r.execution_id, entity: 'call' as const, aiBatch: batch.bolna_batch_id || undefined, aiScope: 'contact' as const}
      : r.entity_id && /^[0-9a-f-]{36}$/i.test(r.entity_id) && r.entity_type
        ? {id: r.entity_id, entity: r.entity_type} : undefined;
    return <tr key={r.member_id}>
      <td><ContactCard name={r.name} phone={r.phone} details={details} metadata={r.city || 'Unknown city'}/>{kind==='ai'&&<WarehouseNotice ids={r.warehouse_ids}/>}</td>
      {kind==='manual'?<ManualBatchCells row={r}/>:<>
      <td><span className="batch-call-state">{r.state}</span></td>
      <td><ResultBadge value={r.outcome}/>{r.wh_id&&<small className="batch-contact-city">WH ID: {r.wh_id}</small>}</td>
      <td><strong>{r.attempts}</strong>{r.connected&&<span className="batch-contact-city">Connected</span>}{r.execution_id&&<div className="record-meta"><RecordDetails aiBatch={batch.bolna_batch_id||undefined} aiScope="contact" initialSection="AI activity" entity="call" id={r.execution_id} label="AI timeline"/></div>}</td>
      </>}
    </tr>;
   })}</tbody>
  </table>{!data.rows.length&&<p className="batch-empty">No batch members match these filters.</p>}</div>
  <RecordsPagination page={data.page} pages={data.pages} total={data.total} pageSize={50} applied={sp} empty="No matching members" label="Batch member pages"/>
 </>;
}
