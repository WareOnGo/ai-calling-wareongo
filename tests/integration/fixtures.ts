import {query,transaction} from '@/lib/db';
/** Historical fixture only: represent rows that predate the completion guard. */
export async function seedLegacyAssignments(sql:string,params:unknown[]=[]){
 return transaction(async client=>{
  await client.query('alter table bolna_assignments disable trigger bolna_assignment_quality_guard');
  const result=await client.query(sql,params);
  await client.query('alter table bolna_assignments enable trigger bolna_assignment_quality_guard');
  return result;
 });
}
/** Explicit connected-call fixture for tests about subsequent ownership changes. */
export async function seedConnectedCalls(){
 await query(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash)
  select gen_random_uuid(),id,assignee,assignee,now(),'connected','fixture connected call' from bolna_assignments where state='open'`);
}
