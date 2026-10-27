import { afterEach,expect,it,vi } from "vitest";
import { EventEmitter } from "node:events";
import { request, type RequestOptions } from "node:https";
import type { ClientRequest,IncomingMessage } from "node:http";
import { requestCallyzer } from "./callyzer-client";
vi.mock("node:https",() => ({ request: vi.fn() }));

function response(status = 200,body: unknown = {result:[]},headers: Record<string,string> = {}) {
  vi.stubEnv("CALLYZER_API_TOKEN","test-only-token");
  vi.stubEnv("CALLYZER_BASE_URL","https://api1.callyzer.co/api/v2.2/");
  const sent = {body:""};
  vi.mocked(request).mockImplementation(((url: URL,options: RequestOptions,callback: (res: IncomingMessage) => void) => {
    const req = new EventEmitter() as ClientRequest;
    req.end = ((data: string) => { sent.body = data; queueMicrotask(() => {
      const res = Object.assign(new EventEmitter(),{statusCode:status,headers}) as IncomingMessage;
      callback(res); res.emit("data",Buffer.from(JSON.stringify(body)));res.emit("end");req.emit("close");
    }); return req; }) as ClientRequest["end"];
    return req;
  }) as typeof request);
  return sent;
}
afterEach(() => { vi.clearAllMocks();vi.unstubAllEnvs(); });
it("uses the verified GET JSON body for employee lookup and POST for history",async () => {
  const sent = response();
  await requestCallyzer("employee/get",{emp_numbers:["91-9876543210"],page_size:99});
  expect(String(vi.mocked(request).mock.calls[0][0])).toBe("https://api1.callyzer.co/api/v2.2/employee/get");
  expect(vi.mocked(request).mock.calls[0][1]).toMatchObject({method:"GET",headers:{Authorization:"Bearer test-only-token","Content-Type":"application/json"}});
  expect(JSON.parse(sent.body)).toEqual({emp_numbers:["91-9876543210"],page_size:99});
  await requestCallyzer("call-log/history",{synced_from:1,synced_to:2,call_method:"PhoneCall",call_mode:"Voice"});
  expect(vi.mocked(request).mock.calls[1][1]).toMatchObject({method:"POST"});
});
it("returns a safe rate-limit error without copying provider data",async () => {
  response(429,{message:"private contact details"},{"retry-after":"120"});
  await expect(requestCallyzer("employee/get",{})).rejects.toMatchObject({message:"Callyzer HTTP 429",status:429,retryAfterMs:120000});
});
it("rejects redirects, unexpected response shapes, and untrusted base URLs",async () => {
  response(302,{}, {location:"https://example.com/secret"});
  await expect(requestCallyzer("employee/get",{})).rejects.toThrow("HTTP 302");
  expect(request).toHaveBeenCalledTimes(1);
  response(200,{result:null});
  await expect(requestCallyzer("employee/get",{})).rejects.toThrow("Invalid Callyzer response");
  vi.stubEnv("CALLYZER_BASE_URL","https://example.com/");
  await expect(requestCallyzer("employee/get",{})).rejects.toThrow("Unsupported");
});
