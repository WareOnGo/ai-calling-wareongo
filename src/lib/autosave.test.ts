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
  it('retains a dependent result draft on validation failure while rolling back Done',async()=>{
    const values={outcome:'Unavailable',state:'open',remarks:''};
    const error=Object.assign(new Error('Explain the closure'),{field:'remarks'});
    const send=vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const save=new Autosave(values,send,['outcome','state'],['outcome']);
    save.set('outcome','Unclear');save.set('state','done');await save.flush();
    expect(save.getSnapshot()).toMatchObject({values:{outcome:'Unclear',state:'open'},status:'error',dirty:true});
    save.set('remarks','Explained and escalated to the administrator');await save.flush();
    expect(save.getSnapshot().dirty).toBe(true);
    save.retry();await vi.waitFor(()=>expect(save.getSnapshot()).toMatchObject({values:{outcome:'Unclear',state:'done'},status:'saved',dirty:false}));
    expect(send).toHaveBeenLastCalledWith({outcome:'Unclear',state:'done'});
  });
  it('still rolls back a result draft on an unconfirmed network failure',async()=>{
    const save=new Autosave({outcome:'Unavailable'},vi.fn().mockRejectedValue(new Error('offline')),['outcome'],['outcome']);
    save.set('outcome','Unclear');await save.flush();expect(save.getSnapshot()).toMatchObject({values:{outcome:'Unavailable'},status:'error',dirty:true});
  });
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

  it('rebases only local edits and rolled-back intent onto the reviewed version', async () => {
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Changed'), {code:'ASSIGNMENT_CONFLICT'})).mockResolvedValue(undefined);
    const save = new Autosave(initial, send, ['added']);
    save.set('notes','My draft'); save.set('added',true); await save.flush();
    expect(save.getSnapshot()).toMatchObject({code:'ASSIGNMENT_CONFLICT',values:{added:false}});
    save.rebase({...initial,state:'done',notes:'Other editor'},true);
    expect(save.getSnapshot()).toMatchObject({status:'dirty',code:undefined,error:'',values:{notes:'My draft',added:true,state:'done'}});
    await save.flush();
    expect(send).toHaveBeenLastCalledWith({notes:'My draft',added:true});
    expect(save.getSnapshot().dirty).toBe(false);
  });

  it.each([true,false])('accepts a lost-response result without another write (keep draft: %s)', async keepDraft => {
    const send = vi.fn().mockRejectedValue(new Error('Response lost'));
    const save = new Autosave(initial, send);
    save.set('notes','Already saved'); await save.flush();
    save.rebase({...initial,notes:'Already saved'},keepDraft);
    await save.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(save.getSnapshot()).toMatchObject({status:'saved',dirty:false,error:''});
    expect(save.getDraft()).toEqual({});
  });

  it('uses latest values as the baseline for later saves and discards', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Changed'));
    const save = new Autosave(initial,send);
    save.set('notes','Draft'); await save.flush();
    save.rebase({...initial,notes:'Latest',added:true},false);
    expect(save.getSnapshot()).toMatchObject({dirty:false,values:{notes:'Latest',added:true}});
    save.set('notes','Next edit'); save.discard();
    expect(save.getSnapshot().values.notes).toBe('Latest');
    expect(save.getDraft()).toEqual({});
  });

  it('keeps a newer edit made during the failed request when reviewing', async () => {
    const gate=deferred();
    const save=new Autosave(initial,()=>gate.promise);
    save.set('notes','First'); const finish=save.flush();
    save.set('notes','Newer draft'); gate.reject(new Error('Changed')); await finish;
    save.rebase({...initial,notes:'Other editor'},true);
    expect(save.getDraft()).toEqual({notes:'Newer draft'});
  });

  it('does not rebase an in-flight save', async () => {
    const gate=deferred(); const save=new Autosave(initial,()=>gate.promise);
    save.set('notes','Saving'); const finish=save.flush();
    save.rebase({...initial,notes:'Other editor'},false);
    expect(save.getSnapshot()).toMatchObject({status:'saving',values:{notes:'Saving'}});
    gate.resolve(); await finish;
    expect(save.getSnapshot()).toMatchObject({status:'saved',values:{notes:'Saving'}});
  });

  it('adopts confirmed server fields while retaining newer local edits during a save', async () => {
    let finish!: (value: typeof initial) => void;
    const response = new Promise<typeof initial>(resolve => { finish=resolve; });
    const save=new Autosave(initial,()=>response);
    save.set('notes','First'); const saving=save.flush();
    save.set('notes','Newer');
    finish({...initial,notes:'First',added:true}); await saving;
    expect(save.getSnapshot()).toMatchObject({status:'dirty',values:{notes:'Newer',added:true}});
    expect(save.getBaseline()).toEqual({...initial,notes:'First',added:true});
    expect(save.getDraft()).toEqual({notes:'Newer'});
  });

  it('keeps a failed checkbox intent when another field returns confirmed server values', async () => {
    const send=vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({...initial,notes:'Saved'});
    const save=new Autosave(initial,send,['added']);
    save.set('added',true); await save.flush();
    save.set('notes','Saved'); await save.flush();
    expect(save.getSnapshot()).toMatchObject({status:'error',values:{added:false,notes:'Saved'}});
    expect(save.getDraft()).toEqual({added:true});
  });

  it('stops queued saves on conflict and rolls back their controls without losing newer intent', async () => {
    const gate=deferred(); const send=vi.fn().mockReturnValue(gate.promise);
    const save=new Autosave(initial,send,['added','state']);
    save.set('notes','First'); const saving=save.flush();
    save.set('notes','Newer'); save.set('state','done',true); save.set('added',true,true);
    gate.reject(Object.assign(new Error('Review required'),{code:'ASSIGNMENT_CONFLICT'})); await saving;
    expect(send).toHaveBeenCalledTimes(1);
    expect(save.getSnapshot()).toMatchObject({status:'error',values:{notes:'Newer',state:'open',added:false}});
    expect(save.getDraft()).toEqual({notes:'Newer',state:'done',added:true});
  });

  it('keeps an undo to the original value when a recovery write may already have succeeded', async () => {
    const gate=deferred(); const save=new Autosave(initial,()=>gate.promise);
    save.set('notes','Sent value'); const saving=save.flush();
    save.set('notes','original',true);
    gate.reject(Object.assign(new Error('Review newer draft'),{code:'ASSIGNMENT_CONFLICT'})); await saving;
    expect(save.getSnapshot()).toMatchObject({status:'error',dirty:true,values:{notes:'original'}});
    expect(save.getDraft()).toEqual({notes:'original'});
  });
});
