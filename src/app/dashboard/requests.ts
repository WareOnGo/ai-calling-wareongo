export async function requestJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reading = !init?.method || init.method === 'GET';
    if (res.status === 401) throw new Error("Your sign-in expired. Sign in again, then retry.");
    if (res.status === 403) throw new Error(reading ? "You no longer have permission to view this information." : "You no longer have permission to make this change.");
    if (res.status === 404) throw new Error("This record is no longer available to you. Ask an admin to check its assignment.");
    if (res.status >= 500) throw new Error(reading ? "Couldn't load this information. Try again." : "Couldn't reach the service. Your change hasn't been saved. Try again.");
    throw new Error(data.error || "Couldn't complete the change. Check your input and retry.");
  }
  return data;
}
