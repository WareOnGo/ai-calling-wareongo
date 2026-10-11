import {it,afterAll,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {query,transaction,getPool} from '@/lib/db';
import {getRawRecords,getRawRecordIds,rawExportQuery} from '@/lib/raw';
import {getCalls,callsExportQuery} from '@/lib/calls';
import {listAssignments,updateAssignment} from '@/lib/assignments';
import {personalWork} from '@/lib/personal-work';
import {getAssigneeWorkloads} from '@/lib/users';
import {teamSummary,teamDetails,parseTeamFilters} from '@/lib/team-report';
import {currentAssignmentLateral,ownershipFilter} from '@/lib/scope';
import {getBatch,batchMembers} from '@/lib/batch-browser';
import {previewAssignment,assignEntities} from '@/lib/assignment-allocation';
const admin={email:'admin@perf.test',name:null,isAdmin:true},employee={email:'caller1@perf.test',name:null,isAdmin:false};
afterAll(async()=>{await getPool().end();});
it('measures representative local volume and preserves correct pages and scopes',async()=>{
 if(new URL(process.env.TEST_DATABASE_URL||'').port!=='55439')throw Error('Dedicated disposable performance DB only');
 if(process.env.BENCH_LABEL==='inspect'){
  const queries={owner:`select r.id from raw_records r ${currentAssignmentLateral('record','r.id',admin,[])} where r.id=md5('record1')::uuid`,unassigned:`select count(*) from raw_records r where ${ownershipFilter('record','r.id',{assignment_state:'unassigned'},[]).join(' and ')}`};
  // Projecting ownership prevents the optimizer from pruning the diagnostic join.
  queries.owner=queries.owner.replace('select r.id','select r.id,asg.current_assignee');
  for(const [name,sql] of Object.entries(queries)){const result=await transaction(async client=>{await client.query('set local statement_timeout=120000');return client.query(`explain(analyze,buffers,format json) ${sql}`)});writeFileSync(`/tmp/bolna-plan-${name}.json`,JSON.stringify(result.rows[0]['QUERY PLAN'],null,2));}
  return;
 }
 const started=Date.now();
 await transaction(async client=>{
  await client.query('set local statement_timeout=0');
  await client.query('truncate bolna_ai_attempts,bolna_assignments,bolna_assignment_batches,bolna_app_users,bolna_webhook_events,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade');
  await client.query(`insert into bolna_app_users(email,name,role) values ('admin@perf.test','Perf admin','admin');
   insert into bolna_app_users(email,name,role) select 'caller'||i||'@perf.test','Caller '||i,'employee' from generate_series(0,9) i;
   insert into raw_records(id,source,source_record_id,owner_name,city,state,area_sqft,metadata)
    select md5('record'||i)::uuid,case when i%2=0 then 'alpha' else 'beta' end,i::text,'Warehouse Owner '||i,
     case when i%2=0 then 'Bengaluru' else 'Delhi' end,case when i%2=0 then 'Karnataka' else 'Delhi' end,
     (i%1000)*100,jsonb_build_object('rent',5000+i) from generate_series(1,50000) i;
   insert into raw_phone_numbers(phone_last10,phone) select (8000000000::bigint+i)::text,'+91'||(8000000000::bigint+i) from generate_series(1,50000) i;
   insert into raw_phones(master_id,phone_id,is_primary) select md5('record'||i)::uuid,p.phone_id,true from generate_series(1,50000) i join raw_phone_numbers p on p.phone_last10=(8000000000::bigint+i)::text;
   insert into bolna_call_logs(id,status,agent_id,call_type,to_number,phone_id,call_created_at,transcript,llm_availability,context_details,built_up_area_sqft,expected_rent,enriched)
    select md5('call'||i)::uuid,'completed','00000000-0000-0000-0000-000000000001','outbound',p.phone,p.phone_id,
     now()-i*interval '1 minute',repeat('user: Warehouse discussion. ',120),case when i%3=0 then 'Available' else 'Unclear' end,
     jsonb_build_object('recipient_data',jsonb_build_object('name','Warehouse Owner '||i,'area',case when i%2=0 then 'Bengaluru' else 'Delhi' end)),
     ((i%1000)*100)::text,'25000/month',true from generate_series(1,10000) i join raw_phone_numbers p on p.phone_last10=(8000000000::bigint+i)::text;
   -- Retained historical completions intentionally predate attempt enforcement.
   alter table bolna_assignments disable trigger bolna_assignment_quality_guard;
   insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome,assigned_at,completed_at)
    select 'record',md5('record'||i)::uuid,'caller'||(i%10)||'@perf.test','admin@perf.test',case when i%3=0 then 'done' else 'open' end,
     case when i%3=0 then 'Unavailable' end,now()-interval '1 day',case when i%3=0 then now() end from generate_series(1,3000) i;
   insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,assigned_at)
    select 'call',md5('call'||i)::uuid,'caller'||(i%10)||'@perf.test','admin@perf.test',now()-interval '1 day' from generate_series(3001,5000) i;
   alter table bolna_assignments enable trigger bolna_assignment_quality_guard;
   insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,duration_seconds,request_hash)
    select gen_random_uuid(),id,assignee,assignee,now()-interval '1 hour','connected',45,'fixture' from bolna_assignments;
   select bolna_record_ai_evidence(jsonb_build_object('id',md5('call'||i)::uuid,'status','completed','initiated_at','2026-10-10T03:00:00Z',
    'conversation_duration',45,'transcript','user: yes','telephony_data',jsonb_build_object('provider_call_id','perf-'||i,'call_type','outbound','duration',45,'to_number','+91'||(8000000000::bigint+i))),'retained') from generate_series(1,2000) i;
   analyze raw_records;analyze raw_phone_numbers;analyze raw_phones;analyze bolna_call_logs;analyze bolna_assignments;
   analyze bolna_assignment_changes;analyze bolna_manual_attempts;analyze bolna_ai_attempts;`);
 });
 const report:{volume:object;seedMs:number;label:string;measurements:Record<string,unknown>;plans:Record<string,unknown>}={volume:{raw:50000,calls:10000,assignments:5000,manualAttempts:5000,aiAttempts:2000,callers:10},seedMs:Date.now()-started,label:process.env.BENCH_LABEL||'current',measurements:{},plans:{}};
 const failures:string[]=[];
 const measure=async(name:string,fn:()=>Promise<unknown>)=>{
  const ms:number[]=[];let bytes=0,error:string|undefined;
  for(let i=0;i<5;i++){const at=performance.now();try{const result=await fn();bytes=Buffer.byteLength(JSON.stringify(result));ms.push(Math.round(performance.now()-at));}catch(e){error=String(e);failures.push(name);break;}}
  const sorted=[...ms].sort((a,b)=>a-b);report.measurements[name]={ms,p95:sorted.at(-1),jsonBytes:bytes,...(error?{error}:{})};console.log(name,JSON.stringify(report.measurements[name]));
 };
 await measure('raw_first',async()=>{const r=await getRawRecords(admin,{});expect(r.total).toBe(50000);return r;});
 await measure('raw_page_400',()=>getRawRecords(admin,{page:400}));
 await measure('raw_unassigned',()=>getRawRecords(admin,{assignment_state:'unassigned'}));
 await measure('raw_search',()=>getRawRecords(admin,{q:'Warehouse Owner 49999'}));
 await measure('calls_search',()=>getCalls(admin,{q:'Owner 9999'}));
 await measure('raw_filters',()=>getRawRecords(admin,{city:'Bengaluru',min_area:25000,max_area:50000,source:['alpha','beta']}));
 await measure('calls_first',async()=>{const r=await getCalls(admin,{});expect(r.total).toBe(10000);return r;});
 await measure('calls_page_200',()=>getCalls(admin,{page:200}));
 await measure('calls_filters',()=>getCalls(admin,{city:'Bengaluru',availability:['Available','Unclear'],min_area:25000}));
 await measure('assignments_page_50',()=>listAssignments(admin,{page:50}));
 await measure('personal_work',()=>personalWork(employee,'record',{},1));
 await measure('team_workloads',()=>getAssigneeWorkloads());
 const teamFilters=parseTeamFilters({});
 await measure('team_report',async()=>{const rows=await teamSummary(admin,teamFilters,new Date(),true);expect(rows.reduce((sum,r)=>sum+(r.counts.attempts||0),0)).toBe(5000);return rows;});
 await measure('team_evidence',()=>teamDetails(admin,teamFilters));
 const ids=(await getRawRecordIds(admin,{min_area:90000},250)).ids;
 await measure('preview_250',()=>previewAssignment({entity:'record',ids,assignees:['caller1@perf.test','caller2@perf.test'],assignedBy:admin.email}));
 await measure('all_matching_ids_20000',()=>getRawRecordIds(admin,{},20000));
 const editable=(await query("select id::text,assignee from bolna_assignments where state='open' order by id limit 10")).rows;
 let revision=0;await measure('ten_concurrent_saves',async()=>{const current=revision++;return Promise.all(editable.map(a=>updateAssignment(a.id,{email:a.assignee,name:null,isAdmin:false},{revision:current,remarks:`Performance save ${current}`})));});
 const manualRun=await assignEntities({entity:'record',ids,assignees:['caller1@perf.test','caller2@perf.test'],assignedBy:admin.email});
 const manualBatch=await getBatch(admin,'manual',manualRun.batchId!);
 await measure('manual_batch_250',()=>batchMembers(admin,manualBatch));
 const aiBatchId=(await query("insert into call_batches(created_by,state,bolna_batch_id) values($1,'completed','perf-ai') returning id",[admin.email])).rows[0].id;
 await query("insert into call_batch_items(batch_id,record_id,name,contact_number) select $1,md5('record'||i),'Warehouse Owner '||i,'+91'||(8000000000::bigint+i) from generate_series(1,250) i",[aiBatchId]);
 await query("update bolna_call_logs set batch_id='perf-ai' where id in(select md5('call'||i)::uuid from generate_series(1,250) i)");
 const aiBatch=await getBatch(admin,'ai',aiBatchId);await measure('ai_batch_250',()=>batchMembers(admin,aiBatch));
 for(const [name,spec] of [['calls',callsExportQuery(admin,{})],['raw',rawExportQuery(admin,{})]] as const){try{report.plans[name]=(await query(`explain(analyze,buffers,format json) ${spec.sql} limit 25`,spec.params)).rows[0]['QUERY PLAN'];}catch(e){report.plans[name]={error:String(e)};}}
 // Verify the selective real-volume plan actually uses the new search index.
 const searchSpec=rawExportQuery(admin,{q:'49999'});
 const searchPlan=(await query(`explain(analyze,buffers,format json) ${searchSpec.sql} limit 25`,searchSpec.params)).rows[0]['QUERY PLAN'];
 expect(JSON.stringify(searchPlan)).toContain('bolna_raw_search_trgm');
 report.plans.selectiveSearch=searchPlan;
 writeFileSync('/tmp/bolna-review-search-plan.json',JSON.stringify(searchPlan,null,2));
 const path=`/tmp/bolna-handoff-performance-${report.label}.json`;writeFileSync(path,JSON.stringify({...report,plans:undefined},null,2));console.log('Report:',path);expect(failures).toEqual([]);
});
