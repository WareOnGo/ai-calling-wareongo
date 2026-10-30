import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {query,getPool} from '@/lib/db';
import {manualHistory,manualHistorySummaries,recordManualAttempt} from '@/lib/manual-attempts';
import {GET as detailsApi} from '@/app/api/details/[entity]/[id]/route';

const admin={email:'admin@timeline.test',isAdmin:true},caller={email:'caller@timeline.test',isAdmin:false},other={email:'other@timeline.test',isAdmin:false};
const auth=vi.hoisted(()=>({user:{email:'admin@timeline.test',isAdmin:true}}));
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>auth.user}));
let record:string,execution:string,assignment:string;
const account='manual-timeline-test';
const request=(id=record,entity='record',section='manual')=>detailsApi(new Request(`http://localhost/api/details/${entity}/${id}?section=${section}`),{params:Promise.resolve({id,entity})});
async function imported(id:string,options:{phone?:string|null;owner?:string|null;account?:string;at?:string;duration?:number|null;mode?:string}={}){
 await query(`insert into callyzer_calls(account_key,source_id,employee_number,caller_email,client_number,occurred_at,duration_seconds,call_type,call_method,call_mode)
 values($1,$2,'91-9000000001',$3,$4,$5,$6,'Outgoing',$7,$8)`,[options.account||account,id,options.owner===undefined?caller.email:options.owner,options.phone===undefined?'91-9811100001':options.phone,options.at||'2026-10-20T10:00:00Z',options.duration===undefined?30:options.duration,options.mode?'WhatsAppCall':'PhoneCall',options.mode||'Voice']);
}
beforeAll(()=>{if(new URL(process.env.TEST_DATABASE_URL!).hostname!=='127.0.0.1')throw Error('Disposable local DB required');});
beforeEach(async()=>{
 vi.stubEnv('CALLYZER_ACCOUNT_KEY',account);auth.user={...admin};
 await query('truncate callyzer_calls,bolna_ai_attempts,bolna_assignments,bolna_app_users,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers restart identity cascade');
 await query("insert into bolna_app_users(email,name,role) values($1,'Admin','admin'),($2,'Caller','employee'),($3,'Other caller','employee')",[admin.email,caller.email,other.email]);
 record=randomUUID();execution=randomUUID();
 await query("insert into raw_records(id,source,source_record_id) values($1::uuid,'manual-timeline',$1::text)",[record]);
 const phone=(await query("insert into raw_phone_numbers(phone_last10,phone) values('9811100001','+919811100001') returning phone_id")).rows[0].phone_id;
 await query('insert into raw_phones(master_id,phone_id) values($1,$2)',[record,phone]);
 await query("insert into bolna_call_logs(id,phone_id,call_type,from_number,to_number,status) values($1,$2,'outbound','+919000000000','+919811100001','completed')",[execution,phone]);
 assignment=(await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,assigned_at) values('record',$1,$2,$3,'2026-10-01T00:00:00Z') returning id::text",[record,caller.email,admin.email])).rows[0].id;
});
afterAll(async()=>{vi.unstubAllEnvs();await getPool().end();});

it('interleaves imported calls and corrected staff logs without writing attempts or outcomes',async()=>{
 const first=randomUUID(),correction=randomUUID();
 await recordManualAttempt(assignment,caller,{id:first,revision:0,occurred_at:'2026-10-20T09:00:00Z',disposition:'no_answer',notes:'Staff original'});
 await recordManualAttempt(assignment,caller,{id:correction,revision:1,corrects_id:first,occurred_at:'2026-10-20T09:00:00Z',disposition:'connected',notes:'Correcting the earlier disposition'});
 await imported(first,{at:'2026-10-20T10:00:00Z',duration:null,mode:'Video'});
 const history=await manualHistory(admin,'record',record);
 expect(history).toMatchObject({total:3,logged:2,imported:1,page:1,pages:1});
 expect(history.rows[0]).toMatchObject({source:'callyzer',id:first,duration_seconds:null,call_mode:'Video',assignee:caller.email});
 expect(history.rows.find(e=>e.source==='manual'&&e.id===first)?.superseded).toBe(true);
 expect(history.rows.find(e=>e.source==='manual'&&e.id===correction)?.corrects_id).toBe(first);
 expect((await query('select count(*)::int n from bolna_effective_manual_attempts')).rows[0].n).toBe(1);
 expect((await query('select revision,outcome from bolna_assignments where id=$1',[assignment])).rows[0]).toEqual({revision:2,outcome:null});
 expect(history.rows.some(e=>'request_hash' in e)).toBe(false);
 expect((await manualHistorySummaries(admin,[{entity:'record',id:record}])).get(`record:${record}`)).toEqual({total:3,logged:2,imported:1});
 expect((await manualHistory(admin,'record',record.toUpperCase())).total).toBe(3);
});

it('keeps page summaries equal to their timelines for mixed sources, duplicate targets and empty history',async()=>{
 await imported('own');await imported('other',{owner:other.email});
 await imported('wrong-country',{phone:'1-9811100001'});await imported('other-account',{account:'elsewhere'});
 await recordManualAttempt(assignment,caller,{id:randomUUID(),revision:0,occurred_at:'2026-10-20T09:00:00Z',disposition:'connected'});
 const empty=randomUUID();await query("insert into raw_records(id,source,source_record_id) values($1::uuid,'manual-timeline',$1::text)",[empty]);
 const targets=[{entity:'record' as const,id:record},{entity:'record' as const,id:record},{entity:'call' as const,id:execution},{entity:'record' as const,id:empty}];
 const summaries=await manualHistorySummaries(admin,targets);
 expect(summaries.size).toBe(3);
 expect(summaries.get(`record:${record}`)).toEqual({total:3,logged:1,imported:2});
 expect(summaries.get(`call:${execution}`)).toEqual({total:2,logged:0,imported:2});
 expect(summaries.get(`record:${empty}`)).toEqual({total:0,logged:0,imported:0});
 for(const target of targets){
  const {total,logged,imported}=await manualHistory(admin,target.entity,target.id);
  expect(summaries.get(`${target.entity}:${target.id}`)).toEqual({total,logged,imported});
 }
 const own=await manualHistorySummaries(caller,targets);
 expect(own.get(`record:${record}`)).toEqual({total:2,logged:1,imported:1});
 expect(own.get(`call:${execution}`)?.total).toBe(0);
 await query("update bolna_assignments set state='dropped' where id=$1",[assignment]);
 expect((await manualHistorySummaries(caller,targets)).get(`record:${record}`)?.total).toBe(0);
});

it('matches all linked contact numbers with full country identity and preserves source channels',async()=>{
 const phone=(await query("insert into raw_phone_numbers(phone_last10,phone) values('9811100002','+1 (981) 110-0002') returning phone_id")).rows[0].phone_id;
 await query('insert into raw_phones(master_id,phone_id) values($1,$2)',[record,phone]);
 await imported('india');await imported('international',{phone:'1-9811100002',mode:'Voice'});
 await imported('wrong-country',{phone:'91-9811100002'});await imported('other-country',{phone:'1-9811100001'});
 await imported('missing',{phone:null});await imported('extension',{phone:'91-9811100001 ext 9'});
 await imported('another-account',{account:'not-this-account'});
 const history=await manualHistory(admin,'record',record);
 expect(history.total).toBe(2);expect(history.rows.map(e=>e.id).sort()).toEqual(['india','international']);
 const shared=randomUUID();await query("insert into raw_records(id,source,source_record_id) values($1::uuid,'manual-timeline',$1::text)",[shared]);
 await query('insert into raw_phones(master_id,phone_id) select $1,phone_id from raw_phones where master_id=$2',[shared,record]);
 expect((await manualHistory(admin,'record',shared)).total).toBe(2);
});

it('shows employees only their own imported calls on accessible records, including after handoff',async()=>{
 await imported('own');await imported('other',{owner:other.email});await imported('unlinked',{owner:null});
 expect((await manualHistory(admin,'record',record)).total).toBe(3);
 expect((await manualHistory(caller,'record',record)).rows.map(e=>e.id)).toEqual(['own']);
 expect((await manualHistory(other,'record',record)).total).toBe(0);
 auth.user={...other};expect((await request()).status).toBe(404);
 await query("update bolna_assignments set state='dropped' where id=$1",[assignment]);
 await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values('record',$1,$2,$3)",[record,other.email,admin.email]);
 expect((await manualHistory(caller,'record',record)).total).toBe(0);
 auth.user={...caller};expect((await request()).status).toBe(404);
 expect((await manualHistory(other,'record',record)).rows.map(e=>e.id)).toEqual(['other']);
});

it('resolves the contact side of inbound and outbound executions',async()=>{
 await imported('customer');await imported('agent-number',{phone:'91-9000000000'});
 expect((await manualHistory(admin,'call',execution)).rows.map(e=>e.id)).toEqual(['customer']);
 await query("update bolna_call_logs set call_type='inbound',from_number='+919811100001',to_number='+919000000000' where id=$1",[execution]);
 expect((await manualHistory(admin,'call',execution)).rows.map(e=>e.id)).toEqual(['customer']);
 expect((await manualHistory(caller,'call',execution)).total).toBe(0);
});

it('paginates the combined chronology once, without skipping or repeating source events',async()=>{
 await query(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash)
 select gen_random_uuid(),$1,$2,$2,'2026-10-20T10:00:00Z'::timestamptz+g*interval '2 seconds','connected','fixture' from generate_series(1,31) g`,[assignment,caller.email]);
 await query(`insert into callyzer_calls(account_key,source_id,employee_number,caller_email,client_number,occurred_at,duration_seconds,call_type,call_method,call_mode)
 select $1,'import-'||g,'91-9000000001',$2,'91-9811100001','2026-10-20T10:00:01Z'::timestamptz+g*interval '2 seconds',10,'Outgoing','PhoneCall','Voice' from generate_series(1,31) g`,[account,caller.email]);
 const first=await manualHistory(admin,'record',record),second=await manualHistory(admin,'record',record,2);
 expect(first).toMatchObject({total:62,logged:31,imported:31,pages:2});expect(first.rows).toHaveLength(50);expect(second.rows).toHaveLength(12);
 expect(new Set([...first.rows,...second.rows].map(e=>`${e.source}:${e.id}`)).size).toBe(62);
 expect(first.rows.slice(0,4).map(e=>e.source)).toEqual(['callyzer','manual','callyzer','manual']);
 expect(Date.parse(first.rows.at(-1)!.occurred_at)).toBeGreaterThan(Date.parse(second.rows[0].occurred_at));
 expect((await manualHistory(admin,'record',record,999)).page).toBe(2);
 expect((await manualHistory(admin,'record',record,NaN)).page).toBe(1);
});

it('serves imports through the shared details API only in the requested manual section',async()=>{
 await imported('from-provider');
 const manual=await request();expect(manual.status).toBe(200);expect((await manual.json()).manual).toMatchObject({total:1,logged:0,imported:1});
 const overview=await request(record,'record','overview');expect(overview.status).toBe(200);expect(await overview.json()).not.toHaveProperty('manual');
 auth.user={...caller};expect((await request()).status).toBe(200);
 expect((await request(execution,'call')).status).toBe(404);
});
