import {seedLegacyAssignments,seedConnectedCalls} from './fixtures';
import { beforeAll,beforeEach,afterAll,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { query,getPool } from '@/lib/db';
import { getCalls,getCallIds,getCallDetailsByIds,callsExportQuery,countCalls } from '@/lib/calls';
import { getRawRecords,getRawRecordIds,getRawRecordsByIds,rawExportQuery,getRawQueueRows } from '@/lib/raw';
import { resolveAssignment,assignmentRequestSchema } from '@/lib/assignment-request';
import { listAssignments,matchingAssignmentTotals } from '@/lib/assignments';
import { toCallFilters,toRawFilters } from '@/lib/filters';
const admin={email:'admin@test.example',name:null,isAdmin:true},employee={email:'employee@test.example',name:null,isAdmin:false};
const agent=randomUUID();
let ids:string[];
beforeAll(()=>{if(!process.env.TEST_DATABASE_URL||!['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))throw Error('Dedicated local DB only');});
beforeEach(async()=>{
 await query('truncate bolna_ai_attempts, bolna_assignments,bolna_app_users,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers restart identity cascade');
 await query("insert into bolna_app_users(email,role) values ($1,'admin'),($2,'employee')",[admin.email,employee.email]);
 ids=[];
 for(let i=0;i<4;i++){
  const id=randomUUID();ids.push(id);
  await query("insert into raw_records(id,source,source_record_id,city,state,area_sqft,contact_type) values ($1::uuid,$2,$1::text,$3,$4,$5,$6)",[id,i%2?'beta':'alpha',i%2?'Delhi':'Bengaluru',i%2?'Delhi':'Karnataka',i===3?null:(i+1)*1000,i===2?'probable broker':null]);
  const p=(await query('insert into raw_phone_numbers(phone_last10,phone) values ($1,$2) returning phone_id',[`987654321${i}`,`+91987654321${i}`])).rows[0].phone_id;
  await query('insert into raw_phones(master_id,phone_id,is_primary) values ($1,$2,true)',[id,p]);
  await query("insert into bolna_call_logs(id,agent_id,phone_id,to_number,call_type,status,call_created_at,llm_availability,built_up_area_sqft,carpet_area_sqft,expected_rent) values ($1,$2,$3,$4,'outbound','completed',$5,$6,$7,$8,$9)",[id,agent,p,`+91987654321${i}`,`2026-08-0${i+1}T18:30:00Z`,['Available','Unavailable','Unclear','Available'][i],['1,000','2000','3,000 sqft','unknown'][i],['900','1800','','unknown'][i],['45000/month','N/A','unknown','Negotiable'][i]]);
 }
});
afterAll(async()=>{await getPool().end();});
const exported=async(spec:ReturnType<typeof callsExportQuery>)=>(await query<{id:string}>(spec.sql,spec.params)).rows.map(r=>r.id).sort();
it('ORs selected values within categories, ANDs across categories; grid/count/export/assignment agree',async()=>{
 const f=toCallFilters({availability:['Available','Unavailable'],source:['alpha','beta'],state:['Delhi'],agent_id:[agent],call_type:['outbound','inbound']});
 const expected=[ids[1],ids[3]].sort(),grid=await getCalls(admin,f);
 expect(grid.rows.map(r=>r.id).sort()).toEqual(expected);expect(grid.total).toBe(2);expect(await countCalls(admin,f)).toBe(2);
 expect((await getCallIds(admin,f,100)).ids.sort()).toEqual(expected);expect(await exported(callsExportQuery(admin,f))).toEqual(expected);
 const resolved=await resolveAssignment(assignmentRequestSchema.parse({entity_type:'call',assignee:employee.email,filters:f}),admin);expect(resolved.options.ids.sort()).toEqual(expected);
});
it('raw repeated Last Result values survive all matching queue, export and assignment resolution',async()=>{
 const f=toRawFilters({last_result:['Available','Unavailable'],source:['alpha','beta'],min_area:'1000',max_area:'2000'});
 const expected=ids.slice(0,2).sort();expect((await getRawRecords(admin,f)).total).toBe(2);
 expect((await getRawRecordIds(admin,f,100)).ids.sort()).toEqual(expected);
 expect(await exported(rawExportQuery(admin,f))).toEqual(expected);
 const queued=await getRawQueueRows(admin,f);expect(queued.rows.map(r=>r.id).sort()).toEqual(expected);
 const resolved=await resolveAssignment(assignmentRequestSchema.parse({entity_type:'record',assignee:employee.email,filters:f}),admin);expect(resolved.options.ids.sort()).toEqual(expected);
});
it('city/source/size predicates must match the same listing, while all source cities remain visible',async()=>{
 const extra=randomUUID();await query("insert into raw_records(id,source,source_record_id,city,state,area_sqft) values ($1::uuid,'delta',$1::text,'Mumbai','Maharashtra',9000)",[extra]);
 await query('insert into raw_phones(master_id,phone_id,is_primary) select $1,phone_id,true from raw_phones where master_id=$2',[extra,ids[0]]);
 expect((await getCalls(admin,{city:'mumbai',min_area:9000,max_area:9000})).rows.map(r=>r.id)).toEqual([ids[0]]);
 expect((await getCalls(admin,{city:'Bengaluru',min_area:9000})).total).toBe(0);
 expect((await getCalls(admin,{city:'Mumbai',source:['alpha']})).total).toBe(0);
 expect((await getCalls(admin,{city:'Mumbai'})).rows[0].source_cities).toBe('Bengaluru, Mumbai');
});
it('area bases are explicit, comma numerics accepted and unknown/unparsed values never become zero',async()=>{
 expect((await getCalls(admin,{area_basis:'built_up',min_area:1000,max_area:2000})).rows.map(r=>r.id).sort()).toEqual(ids.slice(0,2).sort());
 expect((await getCalls(admin,{area_basis:'built_up',min_area:0})).total).toBe(2);
 expect((await getCalls(admin,{area_basis:'carpet',max_area:1000})).rows.map(r=>r.id)).toEqual([ids[0]]);
 expect((await getCalls(admin,{min_area:0})).total).toBe(3);
 expect(()=>toCallFilters({min_area:200,max_area:100})).toThrow();expect(()=>toCallFilters({min_area:-1})).toThrow();
});
it('rent excludes placeholders but retains substantive text, including negotiable',async()=>{
 expect((await getCalls(admin,{rent_mentioned:'yes'})).rows.map(r=>r.id).sort()).toEqual([ids[0],ids[3]].sort());
 expect((await getCalls(admin,{rent_mentioned:'no'})).total).toBe(2);
 for(const rent of ['',null,'-','Not mentioned','n/a','Unknown']) expect((await query('select bolna_rent_mentioned($1) as yes',[rent])).rows[0].yes).toBe(false);
});
it('onboarding needs both a staff flag and valid WH ID, and manual result never substitutes AI',async()=>{
 for(let i=0;i<4;i++)await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,outcome,added_to_db,wh_id) values ('call',$1,$2,$3,$4,$5,$6)",[ids[i],employee.email,admin.email,i===0?'Unavailable':null,i!==1,['1000','1002','N/A',null][i]]);
 expect((await getCalls(admin,{onboarded:'yes',manual_outcome:['Unavailable','none']})).rows.map(r=>r.id)).toEqual([ids[0]]);
 expect((await getCalls(admin,{onboarded:'no'})).total).toBe(3);
 expect((await getCalls(admin,{availability:['Available'],manual_outcome:['Unavailable']})).total).toBe(1);
 expect((await getCalls(employee,{onboarded:'yes'})).total).toBe(1);
});
it('IST date bounds include both midnight edges correctly',async()=>{
 expect((await getCalls(admin,{date_from:'2026-08-02',date_to:'2026-08-02'})).rows.map(r=>r.id)).toEqual([ids[0]]);
 expect(()=>toCallFilters({date_from:'2026-08-03',date_to:'2026-08-02'})).toThrow();
});
it('pagination clamps invalid and excessive pages without dropping criteria; injection stays a bound value',async()=>{
 const f={source:['alpha','beta'],pageSize:1};expect((await getCalls(admin,{...f,page:100})).page).toBe(4);
 expect((await getRawRecords(admin,{...f,page:-5})).page).toBe(1);
 expect((await getCalls(admin,{source:["' OR true --"]})).total).toBe(0);
 expect((await getCalls(employee,{})).total).toBe(0);
 expect(await getCalls(admin,{q:'uniqueNoSuchFixtureTerm',page:999})).toMatchObject({total:0,rows:[],page:1,pages:1});
});
it('assignment history and matching totals accept multiple people, states, outcomes and channels',async()=>{
 for(let i=0;i<3;i++)await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome) values ('record',$1,$2,$3,$4,$5)",[ids[i],i===0?admin.email:employee.email,admin.email,i===2?'done':'open',i===2?'Unavailable':null]);
 const f={assignee:[admin.email,employee.email],state:['open','done'],outcome:['Unavailable','none'],entity_type:['call','record']};
 expect((await listAssignments(admin,f)).total).toBe(3);expect((await matchingAssignmentTotals(admin,f)).reduce((n,r)=>n+Number(r.n),0)).toBe(3);
 expect((await listAssignments(employee,f)).total).toBe(2);
});

it('grid previews stay bounded while search, lazy details and exports preserve complete evidence',async()=>{
 const transcript='user: '+ 'a'.repeat(4000)+' rareSearchTail';
 await query('update bolna_call_logs set transcript=$1 where id=$2',[transcript,ids[0]]);
 const grid=await getCalls(admin,{q:'rareSearchTail'});expect(grid.total).toBe(1);expect(grid.rows[0].transcript).toHaveLength(240);expect(grid.rows[0].raw_matches).toBeNull();
 expect((await getCallDetailsByIds(admin,[ids[0]]))[0].transcript).toBe(transcript);
 const spec=callsExportQuery(admin,{q:'rareSearchTail'});expect((await query(spec.sql,spec.params)).rows[0].transcript).toBe(transcript);
 const raw=(await getRawRecords(admin,{max_area:1000})).rows[0];expect(raw.last_transcript).toHaveLength(240);expect(raw.calls_history).toBeNull();
 const detail=(await getRawRecordsByIds(admin,[ids[0]]))[0];expect(detail.last_transcript).toBe(transcript);expect(detail.calls_history).toHaveLength(1);
});
it('bounded page projections preserve order, distinct rows and employee visibility on every page',async()=>{
 await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) select 'call',id,$1,$2 from bolna_call_logs where id=any($3::uuid[])",[employee.email,admin.email,ids.slice(1)]);
 const visible=[];for(let page=1;page<=3;page++){const result=await getCalls(employee,{page,pageSize:1});expect(result.total).toBe(3);visible.push(result.rows[0].id);}
 expect(visible).toEqual(ids.slice(1).reverse());
 const all=[];for(let page=1;page<=4;page++)all.push((await getRawRecords(admin,{page,pageSize:1})).rows[0].id);
 expect(new Set(all).size).toBe(4);expect(all).toEqual([ids[2],ids[1],ids[0],ids[3]]);
});
