import { createHash, randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { envInt } from "./api";
import { CALLYZER_STREAMS, callyzerAccount, callyzerFlag, callyzerTime, indiaDate, normalizeEmployeeNumber, parseCallyzerCall, trackingStart, type CallyzerDevice, type SyncState } from "./callyzer";
import { CallyzerError, requestCallyzer, type CallyzerRequest } from "./callyzer-client";

const RATE_MS = 2200;
const OVERLAP_SECONDS = 3600;
class LeaseLost extends Error {}
class BudgetExpired extends Error {}

/** One account lease, three resumable streams, no network calls inside a transaction. */
export async function syncCallyzer(options: { request?: CallyzerRequest; now?: () => number; sleep?: (ms: number) => Promise<void>; maxRequests?: number } = {}) {
  if (!process.env.CALLYZER_API_TOKEN?.trim()) return { status: "not_configured", pages: 0, calls: 0 };
  const account = callyzerAccount(), token = randomUUID();
  // Elapsed time budgets are independent of adjustments to the app's wall clock.
  const now = options.now || (() => performance.now()), sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const request = options.request || requestCallyzer;
  await query("insert into callyzer_sync_state(account_key) values($1) on conflict do nothing", [account]);
  const acquired = await query<SyncState & { last_attempt_at: string }>(`update callyzer_sync_state set lease_token=$2,lease_until=clock_timestamp()+interval '90 seconds',last_attempt_at=clock_timestamp()
    where account_key=$1 and (lease_until is null or lease_until<clock_timestamp())
    and (next_attempt_at is null or next_attempt_at<=clock_timestamp()) returning streams,last_attempt_at::text,last_success_at::text,last_error`, [account,token]);
  if (!acquired.rowCount) return { status: "busy_or_backoff", pages: 0, calls: 0 };
  const state = acquired.rows[0], deadline = now() + 35000;
  const asOf = Date.parse(state.last_attempt_at), latestTarget = Math.floor(asOf/1000)-60;
  // Finish an interrupted cycle before chasing a later moving upper bound.
  const target = Math.min(latestTarget,...Object.values(state.streams).flatMap(s => s?.window ? [s.window.to] : []));
  const since = Math.floor(Date.parse(trackingStart(indiaDate(new Date(asOf - envInt("CALLYZER_HISTORY_DAYS",30,179) * 86400000))))/1000);
  let pages = 0, calls = 0, requests = 0;
  let requestOrder = Math.max(0,...Object.values(state.streams).map(s => s?.request_order || 0));
  const maxRequests = options.maxRequests ?? 12;
  const canRequest = () => now() < deadline - 15000 && requests < maxRequests;
  async function paced(path: Parameters<CallyzerRequest>[0], body: Record<string, unknown>) {
    // The account lease serializes requests. Read the remaining cooldown on the
    // database clock; app instances can disagree about the current wall time.
    const slot = await query<{ delay_ms: number }>(`update callyzer_sync_state set streams=$3::jsonb
      where account_key=$1 and lease_token=$2 and lease_until>clock_timestamp()
      returning greatest(0,extract(epoch from(next_request_at-clock_timestamp()))*1000)::float8 delay_ms`, [account,token,JSON.stringify(state.streams)]);
    if (!slot.rowCount) throw new LeaseLost();
    const delay = Math.ceil(slot.rows[0].delay_ms);
    if (now()+delay+12000 > deadline) throw new BudgetExpired();
    if (delay) await sleep(delay);
    if (now()+12000 > deadline) throw new BudgetExpired();
    // A suspended worker can lose its lease while waiting. Fence the HTTP start too.
    const fence = await query(`select 1 from callyzer_sync_state
      where account_key=$1 and lease_token=$2 and lease_until>clock_timestamp()+interval '12 seconds'`, [account,token]);
    if (!fence.rowCount) throw new LeaseLost();
    if (now()+12000 > deadline) throw new BudgetExpired();
    requests++;
    try {
      return await request(path, body);
    } finally {
      // Start the cooldown after the response: a delayed database query must not
      // compress the interval between provider requests, including failed ones.
      const cooldown = await query(`update callyzer_sync_state
        set next_request_at=clock_timestamp()+$3::int*interval '1 millisecond'
        where account_key=$1 and lease_token=$2 and lease_until>clock_timestamp() returning 1`,
      [account,token,RATE_MS]);
      if (!cooldown.rowCount) throw new LeaseLost();
    }
  }
  try {
    for (const stream of CALLYZER_STREAMS) {
      const progress = state.streams[stream.key] ||= { since, through: since, backfilled: false };
      if (!progress.window && progress.through < target) {
        const from = progress.backfilled ? Math.max(progress.since,progress.through-OVERLAP_SECONDS) : progress.through;
        progress.window = {from,to:Math.min(target,from+179*86400),page:1};
      }
    }
    // Persist request order before HTTP so fairness survives clock differences,
    // short runs and failed pages. Successful page writes still own the watermark.
    while (canRequest()) {
      const stream = CALLYZER_STREAMS.filter(s => state.streams[s.key]!.through < target || state.streams[s.key]!.window)
        .sort((a,b) => (state.streams[a.key]!.request_order || 0)-(state.streams[b.key]!.request_order || 0))[0];
      if (!stream) break;
      const progress = state.streams[stream.key]!;
      const from = progress.backfilled ? Math.max(progress.since, progress.through - OVERLAP_SECONDS) : progress.through;
      const window = progress.window ||= { from, to: Math.min(target, from + 179 * 86400), page: 1 };
      progress.request_order = ++requestOrder;
      const prefix = progress.backfilled ? "synced" : "call";
      const response = await paced("call-log/history", { [`${prefix}_from`]: window.from, [`${prefix}_to`]: window.to,
        call_method: stream.method, call_mode: stream.mode, page_no: window.page, page_size: window.page_size ?? 99 });
      const size = response.page_size, total = response.total_records;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > 100 ||
        response.page_no !== window.page || typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 ||
        response.result.length > size || (window.page_size !== undefined && window.page_size !== size)) throw new CallyzerError("Callyzer pagination mismatch");
      const consumed = (window.page-1)*size+response.result.length;
      if (response.result.length < size && total > consumed || response.result.length > 0 && total < consumed) throw new CallyzerError("Callyzer pagination mismatch");
      const rows = response.result.map(row => parseCallyzerCall(row,stream));
      const hash = createHash("sha256").update(JSON.stringify(rows.map(row => row.source_id).sort())).digest("hex");
      if (rows.length && (hash === window.hash || new Set(rows.map(row => row.source_id)).size !== rows.length)) throw new CallyzerError("Callyzer repeated a history page");
      if (rows.length < size) {
        progress.through = window.to;
        // The first bounded call-time window establishes our historical baseline.
        progress.backfilled = true;
        delete progress.window;
      } else { window.page++; window.page_size = size; window.hash = hash; }
      await transaction(async client => {
        // Serialize attribution with link edits so a racing link cannot miss a new row.
        await client.query("select pg_advisory_xact_lock(81620401)");
        const fence = await client.query("select 1 from callyzer_sync_state where account_key=$1 and lease_token=$2 and lease_until>clock_timestamp() for update", [account,token]);
        if (!fence.rowCount) throw new LeaseLost();
        if (rows.length) await client.query(`insert into callyzer_calls(account_key,source_id,employee_number,caller_email,client_name,client_number,occurred_at,duration_seconds,call_type,call_method,call_mode,provider_synced_at,provider_modified_at)
          select $1,r.source_id,r.employee_number,u.email,r.client_name,r.client_number,r.occurred_at,r.duration_seconds,r.call_type,r.call_method,r.call_mode,r.provider_synced_at,r.provider_modified_at
          from jsonb_to_recordset($2::jsonb) as r(source_id text,employee_number text,client_name text,client_number text,occurred_at timestamptz,duration_seconds int,call_type text,call_method text,call_mode text,provider_synced_at timestamptz,provider_modified_at timestamptz)
          left join bolna_app_users u on u.callyzer_number=r.employee_number and r.occurred_at>=u.callyzer_tracking_since
          on conflict(account_key,source_id) do update set
            employee_number=excluded.employee_number,caller_email=coalesce(callyzer_calls.caller_email,excluded.caller_email),
            client_name=excluded.client_name,client_number=excluded.client_number,occurred_at=excluded.occurred_at,
            duration_seconds=excluded.duration_seconds,call_type=excluded.call_type,call_method=excluded.call_method,call_mode=excluded.call_mode,
            provider_synced_at=excluded.provider_synced_at,provider_modified_at=excluded.provider_modified_at,imported_at=clock_timestamp()
          where coalesce(excluded.provider_modified_at,excluded.provider_synced_at,'-infinity'::timestamptz)
            >=coalesce(callyzer_calls.provider_modified_at,callyzer_calls.provider_synced_at,'-infinity'::timestamptz)`, [account,JSON.stringify(rows)]);
        await client.query("update callyzer_sync_state set streams=$3::jsonb where account_key=$1 and lease_token=$2",[account,token,JSON.stringify(state.streams)]);
      });
      pages++; calls += rows.length;
    }
    const cycleComplete = CALLYZER_STREAMS.every(s => state.streams[s.key]?.backfilled && state.streams[s.key]!.through >= target);
    const caughtUp = CALLYZER_STREAMS.every(s => state.streams[s.key]?.backfilled && state.streams[s.key]!.through >= latestTarget);
    const completed = await query(`update callyzer_sync_state set failures=case when $3 then 0 else failures end,
      last_error=case when $3 then null else last_error end,next_attempt_at=null,
      last_success_at=case when $3 then clock_timestamp() else last_success_at end where account_key=$1 and lease_token=$2 and lease_until>clock_timestamp()`, [account,token,cycleComplete]);
    if (!completed.rowCount) throw new LeaseLost();

    // Device metadata is advisory. Refresh it after call ingestion; a failed lookup
    // means unknown device status, not "employee absent" or a failed call import.
    if (canRequest()) {
      const employee = (await query<{ email: string; callyzer_number: string }>(`select email,callyzer_number from bolna_app_users
        where callyzer_number is not null and (callyzer_device is null or (callyzer_device->>'checked_at')::timestamptz<clock_timestamp()-interval '1 hour')
        order by callyzer_device->>'checked_at' nulls first,email limit 1`)).rows[0];
      if (employee) {
        const device: Omit<CallyzerDevice,"checked_at"> = { found: null, last_sync_req_at: null };
        let accountError: CallyzerError | null = null;
        try {
          const result = await paced("employee/get",{emp_numbers:[employee.callyzer_number],page_no:1,page_size:99});
          const match = result.result.find(value => {
            if (!value || typeof value !== "object") return false;
            const row = value as Record<string,unknown>;
            try { return normalizeEmployeeNumber(`${row.emp_country_code}-${row.emp_number}`) === employee.callyzer_number; } catch { return false; }
          }) as Record<string,unknown> | undefined;
          device.found = !!match;
          try { device.last_sync_req_at = callyzerTime(match?.last_sync_req_at); } catch { /* Invalid metadata time stays unknown. */ }
          const settings = match?.app_settings as Record<string,unknown> | undefined;
          const preferences = match?.device_preference as Record<string,unknown> | undefined;
          device.logging_enabled = callyzerFlag(settings?.is_log_active);
          device.app_uninstalled = callyzerFlag(preferences?.is_app_uninstalled);
        } catch (error) {
          if (error instanceof LeaseLost || error instanceof BudgetExpired) throw error;
          device.error = error instanceof CallyzerError ? error.message : "Employee lookup failed";
          if (error instanceof CallyzerError && [401,403,429].includes(error.status || 0)) accountError = error;
        }
        const updated = await query(`update bolna_app_users set callyzer_device=$3::jsonb||jsonb_build_object('checked_at',clock_timestamp()) where email=$1 and callyzer_number=$2
          and exists(select 1 from callyzer_sync_state where account_key=$4 and lease_token=$5 and lease_until>clock_timestamp())`,
        [employee.email,employee.callyzer_number,JSON.stringify(device),account,token]);
        // A changed caller link simply discards this obsolete lookup.
        if (!updated.rowCount && !(await query("select 1 from callyzer_sync_state where account_key=$1 and lease_token=$2 and lease_until>clock_timestamp()",[account,token])).rowCount) throw new LeaseLost();
        if (accountError) throw accountError;
      }
    }
    return { status: caughtUp ? "current" : "in_progress", pages, calls };
  } catch (error) {
    if (error instanceof LeaseLost) return { status: "lease_lost", pages, calls };
    if (error instanceof BudgetExpired) return { status: "in_progress", pages, calls };
    // Do not persist response payloads, client details, SQL parameters or credentials.
    const message = error instanceof CallyzerError ? error.message : "Callyzer import failed; the unfinished page will be retried";
    const retry = error instanceof CallyzerError ? Math.min(error.retryAfterMs,86400000) : 0;
    await query(`update callyzer_sync_state set failures=failures+1,last_error=$3,
      next_attempt_at=clock_timestamp()+make_interval(secs=>greatest(least(3600,60*power(2,least(failures,6))),$4::double precision))
      where account_key=$1 and lease_token=$2 and lease_until>clock_timestamp()`,[account,token,message,retry/1000]);
    return { status: "retry_scheduled", pages, calls };
  } finally {
    await query("update callyzer_sync_state set lease_token=null,lease_until=null where account_key=$1 and lease_token=$2",[account,token]);
  }
}
