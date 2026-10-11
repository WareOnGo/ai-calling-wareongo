import {allocationLabel} from "@/lib/manual-dispositions";
import Link from 'next/link';
import {ApiError} from '@/lib/api';
import {notFound} from 'next/navigation';
import {requireAdmin} from '@/lib/auth';
import {getBatch,batchMembers,AI_CARDS,MANUAL_CARDS} from '@/lib/batch-browser';
import {firstValue,searchQuery,type SearchValues} from '@/lib/filter-values';
import {dateTime} from '@/lib/display';
import {agentLabel} from '@/lib/agents';
import {RecordDetails} from '../../../RecordDetails';
import {PageJump} from '../../../PageJump';
import {WalletBalance} from '../../../WalletBalance';
import {BatchResolution} from '../../../BatchActivity';
export const dynamic='force-dynamic';
export default async function BatchDetail({params,searchParams}:{params:Promise<{kind:string;id:string}>;searchParams:Promise<SearchValues>}){
 const viewer=await requireAdmin(),{kind,id}=await params,sp=await searchParams;if(kind!=='ai'&&kind!=='manual')notFound();
 let batch;try{batch=await getBatch(viewer,kind,id);}catch(error){if(error instanceof ApiError && error.status===404)notFound();throw error;}
 const metric=firstValue(sp.metric)||'all';let data;try{data=await batchMembers(viewer,batch,metric,Number(firstValue(sp.page)||1));}catch(error){console.error("Batch members failed",{kind,id,error:error instanceof Error?error.name:"Unknown"});return <p role="alert">Could not load batch records. <Link href={`/dashboard/batches/${kind}/${id}`}>Reset filters and retry</Link></p>;}
 const base=`/dashboard/batches/${kind}/${id}`,cards=kind==='ai'?AI_CARDS:MANUAL_CARDS;
 return <>
  <p><Link href={`/dashboard/batches?kind=${kind}`}>Back to {kind==='ai'?'AI':'manual'} batches</Link></p>
  <div className="page-title">{id==='legacy'?'Legacy / no recorded batch':`${kind==='ai'?'AI':'Manual'} batch ${id.slice(0,8)}`}</div>
  {id==='legacy'?<p>These assignments predate recorded batch membership. Their timestamps do not prove that they were assigned together.</p>:<p>{batch.state} · Created {dateTime(batch.created_at)} by {batch.created_by} · {kind==='ai'?agentLabel(batch.agent_id,batch.agent_language):batch.entity_type==='record'?'From Raw Dataset':'From Calls'}</p>}
  {batch.dispatch_request_id&&<p>Parent dispatch: <Link href={`/dashboard/batches?kind=ai&dispatch=${batch.dispatch_request_id}`}>{batch.dispatch_request_id}</Link></p>}
  {batch.bolna_batch_id&&<p>Provider batch: {batch.bolna_batch_id} · <Link href={`/dashboard/calls?${new URLSearchParams({batch_id:batch.bolna_batch_id,include_blocked:'1'})}`}>Open all execution records</Link></p>}
  {batch.scheduled_at&&<p>Scheduled {dateTime(batch.scheduled_at)}</p>}
  {batch.assignees&&<p>Original callers: {batch.assignees.join(', ')}</p>}
  {batch.selection&&<details><summary>Original selection</summary><pre className="batch-selection">{JSON.stringify(batch.selection,null,2)}</pre></details>}
  {batch.last_error&&<p className="row-error">{batch.last_error}</p>}{batch.resolution_note&&<p>Resolution: {batch.resolution_note}</p>}
  {kind==='ai'&&<><WalletBalance/>{!['completed','canceled'].includes(batch.state)&&<BatchResolution batch={batch}/>}</>}
  <div className="batch-metrics">{cards.map(([key,label])=><Link key={key} href={`${base}?metric=${key}`} className={`stat${metric===key?' stat-active':''}`}><strong>{data.metrics[key]}</strong><span>{label}</span></Link>)}</div>
  <p>{data.metrics.attempts} {kind==='ai'?'known provider attempts':'recorded manual attempts'} across this batch. Cards count {kind==='ai'?'unique targeted phone contacts using their latest execution result; attempts and conversations require provider evidence':'original membership records; completion requires the current quality checks'}.</p>
  {kind==='manual'&&<p>Membership is fixed at allocation. Original caller and current contact owner are shown separately. Onboarding is staff-recorded, with a valid WH reference.</p>}
  <p>{data.total} matching {kind==='ai'?'contacts':'records'} · <a href={`/api/batches/${id}/export?kind=${kind}&metric=${metric}`}>Export matching members</a></p>
  <div className="gridwrap batch-grid"><table className="sheet"><thead><tr className="colheads"><th>Contact</th><th>Phone</th><th>City</th>{kind==='manual'&&<><th>Original caller</th><th>Current owner</th><th>Allocation</th></>}<th>State</th><th>{kind==='ai'?'AI result':'Manual result'}</th><th>Recorded attempts</th><th>Details</th></tr></thead>
   <tbody>{data.rows.map(r=><tr key={r.member_id}><td>{r.name||'Unnamed'}</td><td>{r.phone||'Unknown'}</td><td>{r.city||'Unknown'}</td>{kind==='manual'&&<><td>{r.assignee||'Not assigned'}</td><td>{r.current_owner||'Unassigned now'}</td><td>{allocationLabel(r.disposition)}</td></>}<td>{r.state}{r.quality_issue&&<span className="review-tag">Needs completion review</span>}</td><td>{r.outcome||'No result'}{r.wh_id&&<small> · {r.wh_id}</small>}</td><td>{r.attempts}{r.connected?' · connected':''}</td><td>{r.execution_id?<RecordDetails aiBatch={batch.bolna_batch_id||undefined} aiScope="contact" entity="call" id={r.execution_id} label="AI timeline"/>:r.entity_id&&/^[0-9a-f-]{36}$/i.test(r.entity_id)&&r.entity_type?<RecordDetails entity={r.entity_type} id={r.entity_id}/>:null}</td></tr>)}</tbody>
  </table></div>{!data.rows.length&&<p>No batch members match this card.</p>}
  <nav className="pager" aria-label="Batch member pages">{data.page>1&&<Link href={`?${searchQuery({...sp,page:String(data.page-1)})}`}>Previous</Link>}<span>Page {data.page}/{data.pages}</span>{data.page<data.pages&&<Link href={`?${searchQuery({...sp,page:String(data.page+1)})}`}>Next</Link>}</nav>
  <PageJump key={data.page} page={data.page} pages={data.pages}/>
 </>;
}
