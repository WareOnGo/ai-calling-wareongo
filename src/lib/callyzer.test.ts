import { describe,expect,it } from "vitest";
import { CALLYZER_STREAMS, callyzerFlag, callyzerTime, importCoverage, normalizeContactNumber, normalizeEmployeeNumber, parseCallyzerCall, trackingStart, type SyncState } from "./callyzer";

const now = new Date("2026-10-26T09:30:00Z");
const state: SyncState = { streams: Object.fromEntries(CALLYZER_STREAMS.map(s => [s.key,{ since: Date.parse("2026-09-25T18:30:00Z")/1000,through: now.getTime()/1000-60,backfilled: true }])),last_attempt_at: now.toISOString(),last_success_at: now.toISOString(),last_error: null };
const options = { number: "91-9876543210",trackingSince: "2026-09-25T18:30:00Z",configured: true,state,device:{checked_at:now.toISOString(),found:true,last_sync_req_at:null},from: "2026-10-20",to: "2026-10-26",now };

describe("Callyzer time and call normalization",() => {
  it("matches complete contact numbers without conflating countries or extensions",() => {
    for (const phone of ["9811100001","09811100001","+91 98111 00001","91-9811100001","00919811100001"]) expect(normalizeContactNumber(phone)).toBe("919811100001");
    expect(normalizeContactNumber("+1 (981) 110-0001")).toBe("19811100001");
    expect(normalizeContactNumber("1-9811100001")).toBe("19811100001");
    for (const phone of [null,"","123","unknown","9811100001 ext 12","9811100001/9811100002","+1234567890123456"]) expect(normalizeContactNumber(phone)).toBeNull();
  });
  it("parses live employee display timestamps in India time with strict calendar validation",() => {
    expect(callyzerTime("27 Oct 2026, 05:14 PM")).toBe("2026-10-27T11:44:00.000Z");
    expect(callyzerTime("1 Jan 2026, 12:00 AM")).toBe("2025-12-31T18:30:00.000Z");
    expect(callyzerTime("1 Jan 2026, 12:00 PM")).toBe("2026-01-01T06:30:00.000Z");
    for (const value of ["30 Feb 2026, 05:14 PM","27 Foo 2026, 05:14 PM","27 Oct 2026, 00:14 AM","27 Oct 2026, 13:14 PM","27 Oct 2026, 05:60 PM"]) expect(() => callyzerTime(value)).toThrow();
  });
  it("preserves explicit disabled settings and leaves unknown employee flags unknown",() => {
    for (const value of [false,"No"," no "]) expect(callyzerFlag(value)).toBe(false);
    for (const value of [true,"Yes"," YES "]) expect(callyzerFlag(value)).toBe(true);
    for (const value of [undefined,null,"",0,1,"unknown"]) expect(callyzerFlag(value)).toBe(null);
  });
  it("accepts minute-precision call times returned by the live history API",() => {
    const call = {id:"minute-precision",emp_country_code:"91",emp_number:"9876543210",call_date:"2026-10-26",call_time:"10:01",call_type:"Outgoing",duration:20};
    expect(parseCallyzerCall(call,CALLYZER_STREAMS[0]).occurred_at).toBe("2026-10-26T04:31:00.000Z");
    for (const call_time of ["24:00","10:60","1:30","10:01junk"]) expect(() => parseCallyzerCall({...call,call_time},CALLYZER_STREAMS[0])).toThrow();
  });
  it("handles customer-local timestamps, explicit offsets, UTC, and IST day boundaries",() => {
    expect(callyzerTime("2026-10-26 00:00:00 IST")).toBe("2026-10-25T18:30:00.000Z");
    expect(callyzerTime("2026-10-26 00:00:00")).toBe(trackingStart("2026-10-26"));
    expect(callyzerTime("2026-10-26T00:00:00.001+0530")).toBe("2026-10-25T18:30:00.001Z");
    expect(callyzerTime("2026-10-26 00:00:00 UTC")).toBe("2026-10-26T00:00:00.000Z");
    expect(callyzerTime(null)).toBe(null);
    for (const value of ["2026-02-30 00:00:00","2026-10-26 24:00:00","2026-10-26 00:00:00 PST",123]) expect(() => callyzerTime(value)).toThrow();
  });
  it("preserves opaque IDs, string durations, nullable fields and employee numbers",() => {
    const call = { id: "opaque:001/abc",emp_country_code: "91",emp_number: "0987654321",call_date: "2026-10-26",call_time: "10:01:02",call_type: "Outgoing",duration: "3",synced_at: null };
    expect(parseCallyzerCall(call,CALLYZER_STREAMS[0])).toMatchObject({ source_id: "opaque:001/abc",employee_number: "91-0987654321",duration_seconds: 3,provider_synced_at: null });
    expect(parseCallyzerCall({...call,duration:null},CALLYZER_STREAMS[0]).duration_seconds).toBe(null);
    expect(parseCallyzerCall({...call,duration:"  "},CALLYZER_STREAMS[0]).duration_seconds).toBe(null);
    for (const duration of [-1,1.5,"unknown",false,"0x10","1e3"]) expect(() => parseCallyzerCall({...call,duration},CALLYZER_STREAMS[0])).toThrow();
    expect(() => parseCallyzerCall({...call,call_method:"WhatsAppCall"},CALLYZER_STREAMS[0])).toThrow();
    expect(normalizeEmployeeNumber("+91-98765 43210")).toBe("91-9876543210");
    expect(() => normalizeEmployeeNumber("9876543210")).toThrow(/country code/);
  });
});

describe("coverage is not proof of device completeness",() => {
  it("distinguishes unavailable activity from a zero count",() => {
    expect(importCoverage({...options,number:null})).toMatchObject({label:"Manual only",showCounts:true});
    expect(importCoverage({...options,configured:false}).label).toBe("Sync not configured");
    expect(importCoverage({...options,state:null}).label).toBe("Import pending");
    expect(importCoverage({...options,device:null}).label).toBe("Link not checked");
    expect(importCoverage(options)).toMatchObject({label:"Imported",showCounts:true});
  });
  it("requires every selected stream, the linked period, and the imported baseline",() => {
    expect(importCoverage({...options,from:null,to:null}).label).toBe("Partial coverage");
    expect(importCoverage({...options,trackingSince:"2026-10-25T18:30:00Z"}).label).toBe("Partial coverage");
    const partial = {...state,streams:{phone:state.streams.phone}};
    expect(importCoverage({...options,state:partial}).label).toBe("Import pending");
    expect(importCoverage({...options,state:partial,channel:"phone"}).label).toBe("Imported");
  });
  it("flags failure and stalled sync without using last call time as a liveness signal",() => {
    expect(importCoverage({...options,state:{...state,last_error:"Callyzer HTTP 429"}}).label).toBe("Sync delayed");
    expect(importCoverage({...options,state:{...state,last_success_at:"2026-10-26T08:00:00Z"}}).label).toBe("Sync delayed");
  });
  it("never calls future periods imported",() => {
    expect(importCoverage({...options,from:"2026-10-27",to:"2026-10-28"})).toMatchObject({label:"Future period",showCounts:false});
    expect(importCoverage({...options,to:"2026-10-28"}).label).toBe("Partial coverage");
  });
  it("does not present a missing or disabled device as healthy imported coverage",() => {
    const missing = {...options,device:{checked_at:now.toISOString(),found:false,last_sync_req_at:null}};
    expect(importCoverage(missing).label).toBe("Number not found");
    const disabled = {...options,device:{checked_at:now.toISOString(),found:true,last_sync_req_at:now.toISOString(),logging_enabled:false}};
    expect(importCoverage(disabled).label).toBe("Device logging off");
    const uninstalled = {...options,device:{checked_at:now.toISOString(),found:true,last_sync_req_at:now.toISOString(),app_uninstalled:true}};
    expect(importCoverage(uninstalled).label).toBe("App uninstalled");
  });
});
