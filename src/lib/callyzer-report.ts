import { z } from "zod";
import { query } from "./db";
import { ApiError } from "./api";
import type { Viewer } from "./scope";
import type { TeamFilters } from "./team-report";
import { callyzerAccount, CALLYZER_STREAMS, type CallyzerDevice, type ImportedCall, type SyncState } from "./callyzer";

const activitySchema = z.object({
  activity_channel: z.enum(["all","phone","whatsapp_voice","whatsapp_video"]).default("all"),
  activity_caller: z.string().email().max(320).transform(s => s.toLowerCase()).optional(),
  activity_page: z.coerce.number().int().min(1).max(1000000).default(1),
});
export type ActivityFilters = z.infer<typeof activitySchema>;
export const parseActivityFilters = (input: Record<string, unknown>) => activitySchema.parse(Object.fromEntries(Object.entries(input).filter(([,v]) => v !== "" && v !== undefined)));
export type CallerActivity = {
  email: string; name: string | null; active: boolean; callyzer_number: string | null;
  callyzer_tracking_since: string | null; callyzer_device: CallyzerDevice | null;
  calls: number; connected: number; talk_seconds: number; unknown_durations: number; last_call_at: string | null;
};
function adminOnly(viewer: Viewer) { if (!viewer.isAdmin) throw new ApiError(403,"forbidden"); }
function callFilter(f: TeamFilters, activity: ActivityFilters) {
  const channel = CALLYZER_STREAMS.find(s => s.key === activity.activity_channel);
  return {
    params: [callyzerAccount(),f.range === "all" ? null : f.date_from,f.range === "all" ? null : f.date_to,channel?.method || null,channel?.mode || null],
    sql: `account_key=$1 and occurred_at>=coalesce($2::date::timestamp at time zone 'Asia/Kolkata','-infinity'::timestamptz)
      and occurred_at<coalesce(($3::date+interval '1 day') at time zone 'Asia/Kolkata','infinity'::timestamptz)
      and ($4::text is null or call_method=$4) and ($5::text is null or call_mode=$5)`,
  };
}

export async function callyzerReport(viewer: Viewer, f: TeamFilters, activity: ActivityFilters) {
  adminOnly(viewer);
  const spec = callFilter(f,activity);
  const [people, state, unmatched] = await Promise.all([
    query<CallerActivity>(`with totals as (
      select caller_email,count(*)::int calls,
        count(*) filter(where call_type in ('Incoming','Outgoing') and duration_seconds>2)::int connected,
        coalesce(sum(duration_seconds) filter(where call_type in ('Incoming','Outgoing') and duration_seconds>2),0)::float8 talk_seconds,
        count(*) filter(where duration_seconds is null)::int unknown_durations,max(occurred_at) last_call_at
      from callyzer_calls where ${spec.sql} group by caller_email)
      select u.email,u.name,u.active,u.callyzer_number,u.callyzer_tracking_since::text,u.callyzer_device,
        coalesce(t.calls,0)::int calls,coalesce(t.connected,0)::int connected,coalesce(t.talk_seconds,0)::float8 talk_seconds,
        coalesce(t.unknown_durations,0)::int unknown_durations,t.last_call_at::text
      from bolna_app_users u left join totals t on t.caller_email=u.email
      where u.role='employee' and ($6::text is null or u.email=$6) and ($7::boolean is null or u.active=$7)
      order by coalesce(nullif(u.name,''),u.email)`,[...spec.params,f.person?.toLowerCase() || null,f.access ? f.access === "active" : null]),
    query<SyncState>("select streams,last_attempt_at::text,last_success_at::text,last_error from callyzer_sync_state where account_key=$1",[callyzerAccount()]),
    query<{ n: number }>(`select count(*)::int n from callyzer_calls where ${spec.sql} and caller_email is null`,spec.params),
  ]);
  return { people: people.rows, state: state.rows[0] || null, unmatched: unmatched.rows[0].n, configured: !!process.env.CALLYZER_API_TOKEN?.trim() };
}

export async function callyzerHistory(viewer: Viewer, f: TeamFilters, activity: ActivityFilters) {
  adminOnly(viewer);
  if (!activity.activity_caller) return null;
  const spec = callFilter(f,activity), params = [...spec.params,activity.activity_caller,f.person?.toLowerCase() || null,f.access ? f.access === "active" : null];
  const where = `${spec.sql} and caller_email=$6 and ($7::text is null or caller_email=$7)
    and exists(select 1 from bolna_app_users u where u.email=caller_email and u.role='employee' and ($8::boolean is null or u.active=$8))`;
  const total = (await query<{ n: number }>(`select count(*)::int n from callyzer_calls where ${where}`,params)).rows[0].n;
  const pages = Math.max(1,Math.ceil(total/50)), page = Math.min(activity.activity_page,pages);
  const rows = (await query<ImportedCall>(`select source_id,employee_number,client_name,client_number,occurred_at::text,duration_seconds,call_type,call_method,call_mode,
      provider_synced_at::text,provider_modified_at::text
    from callyzer_calls where ${where} order by occurred_at desc,source_id limit 50 offset $9`,[...params,(page-1)*50])).rows;
  return { rows,total,pages,page };
}
