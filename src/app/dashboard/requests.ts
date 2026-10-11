export class RequestError extends Error { constructor(message:string,public field?:string,public code?:string){super(message);} }
export async function requestJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reading = !init?.method || init.method === 'GET';
    if (res.status === 401) throw new Error("Your sign-in expired. Sign in again, then retry.");
    if (res.status === 403) throw new Error(reading ? "You no longer have permission to view this information." : "You no longer have permission to make this change.");
    if (res.status === 404) throw new Error("This record is no longer available to you. Ask an admin to check its assignment.");
    if (res.status >= 500) throw new Error(reading ? "Couldn't load this information. Try again." : "Couldn't confirm the result with the service. Check the current state before trying again.");
    throw new RequestError(data.error || "Couldn't complete the change. Check your input and retry.",data.field,data.code);
  }
  return data;
}
