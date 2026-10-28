import { describe, expect, it, vi } from "vitest";
import { Autosave } from "./autosave";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const initial = { notes: "original", added: false, state: "open" };
describe("confirmed autosave state", () => {
  it("saves a change and a later restoration to the original value", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const save = new Autosave(initial, send);
    save.set("notes", "changed"); await save.flush();
    save.set("notes", "original"); await save.flush();
    expect(send.mock.calls.map(c => c[0])).toEqual([{notes:"changed"},{notes:"original"}]);
    expect(save.getSnapshot()).toMatchObject({status:"saved",dirty:false});
  });
  it("serializes edits made during a request, including restoration", async () => {
    const gate = deferred();
    const send = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const save = new Autosave(initial, send);
    save.set("notes", "changed"); const finish = save.flush();
    save.set("notes", "original", true);
    save.set("added", true, true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(save.getSnapshot().dirty).toBe(true);
    gate.resolve(); await finish;
    expect(send.mock.calls.map(c => c[0])).toEqual([{notes:"changed"},{notes:"original",added:true}]);
    expect(save.getSnapshot().dirty).toBe(false);
  });
  it("rolls back a failed checkbox, retains the failed intent, and retries it", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const save = new Autosave(initial, send, ['added']);
    save.set('added',true); await save.flush();
    expect(save.getSnapshot()).toMatchObject({values:{added:false},status:'error',dirty:true,error:'offline'});
    save.retry();
    await vi.waitFor(() => expect(save.getSnapshot()).toMatchObject({values:{added:true},status:'saved',dirty:false}));
    expect(send).toHaveBeenLastCalledWith({added:true});
  });
  it("keeps failed notes when a different field saves", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const save = new Autosave(initial, send);
    save.set('notes','keep this draft'); await save.flush();
    save.set('state','done'); await save.flush();
    expect(send).toHaveBeenLastCalledWith({state:'done'});
    expect(save.getSnapshot()).toMatchObject({status:'error',dirty:true,values:{notes:'keep this draft',state:'done'}});
    save.retry(); await vi.waitFor(() => expect(save.getSnapshot().dirty).toBe(false));
    expect(send).toHaveBeenLastCalledWith({notes:'keep this draft'});
  });
  it("finishes a newer committed edit after an earlier request fails", async () => {
    const gate = deferred();
    const send = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const save = new Autosave(initial, send);
    save.set('notes','first'); const finish = save.flush();
    save.set('notes','latest',true);
    gate.reject(new Error('offline')); await finish;
    expect(send).toHaveBeenLastCalledWith({notes:'latest'});
    expect(save.getSnapshot()).toMatchObject({status:'saved',dirty:false,values:{notes:'latest'}});
  });
  it("ignores stale refreshes while dirty and discards only unsaved edits", async () => {
    const send = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('offline'));
    const save = new Autosave(initial, send);
    save.set('state','done'); await save.flush();
    save.set('notes','draft'); await save.flush();
    save.reconcile(initial);
    expect(save.getSnapshot().values.notes).toBe('draft');
    save.discard();
    expect(save.getSnapshot()).toMatchObject({dirty:false,values:{notes:'original',state:'done'}});
  });
  it("confirms a restoration after a response is lost", async () => {
    const gate = deferred();
    const send = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const save = new Autosave(initial, send);
    save.set('notes','changed'); const finish = save.flush();
    save.set('notes','original',true);
    gate.reject(new Error('connection lost')); await finish;
    expect(send).toHaveBeenLastCalledWith({notes:'original'});
    expect(save.getSnapshot().dirty).toBe(false);
  });
});
