# Triggering `/api/process` from AWS

The worker is a plain authenticated HTTP endpoint. Anything can drive it on a
schedule. Two AWS options:

## Option 1 — EventBridge Scheduler → HTTPS (no Lambda)

EventBridge Scheduler can POST directly to a public URL via a "Universal target"
/ API destination. Configure:

- **Schedule**: rate expression, e.g. `rate(1 minute)`
- **Target**: API destination pointing at `https://<your-app>.vercel.app/api/process`
- **HTTP method**: `POST`
- **Header**: `Authorization: Bearer <PROCESS_SECRET>`

Store `PROCESS_SECRET` in the connection's auth config (EventBridge connections
support an API key / OAuth; use a custom header `Authorization`).

## Option 2 — Lambda on a schedule (most flexible)

EventBridge rule `rate(1 minute)` → this Lambda:

```js
// index.mjs  (Node 20 Lambda)
export const handler = async () => {
  const res = await fetch(`${process.env.PROCESS_URL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PROCESS_SECRET}` },
  });
  const body = await res.json();
  console.log("process result", res.status, body);
  return { statusCode: res.status, body };
};
```

Lambda env vars:
- `PROCESS_URL = https://<your-app>.vercel.app/api/process`
- `PROCESS_SECRET = <same value as in Vercel>`

## Manual trigger (testing)

```bash
curl -X POST "https://<your-app>.vercel.app/api/process" \
  -H "Authorization: Bearer $PROCESS_SECRET"
```

## Note on cadence

Run as often as you like (every minute is typical). Because each row carries its
own `next_attempt_at`, the worker only touches rows that are actually due — extra
runs that find nothing are cheap no-ops.
