"use client";
import {useEffect,useMemo,useState} from 'react';
import type {BulkAssignmentPreview} from '@/lib/bulk-assignments';
import type {SearchValues} from '@/lib/filter-values';
import {useSelection,SelectionSummary} from '../Selection';
import {useDashboardUI} from '../DashboardUI';
import {requestJson} from '../requests';
import {Dialog} from '../Dialog';

export function BulkAssignmentActions({filters}:{filters:SearchValues}) {
  const {ids,allMatching,hasSelection,clear}=useSelection();
  const {pending,refresh,notify}=useDashboardUI();
  const [action,setAction]=useState<'unassign'|'reopen'|null>(null);
  const [preview,setPreview]=useState<BulkAssignmentPreview|null>(null);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const selection=useMemo(()=>allMatching?{filters}:{ids},[allMatching,filters,ids]);
  useEffect(()=>{
    if(!action)return;
    const controller=new AbortController();setLoading(true);setPreview(null);setError('');
    requestJson<BulkAssignmentPreview>('/api/assignments/bulk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...selection,action}),signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setPreview(result);})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[action,selection,retry]);
  async function apply() {
    if(!preview||busy)return;
    setBusy(true);setError('');
    try {
      const result=await requestJson<{changed:number}>('/api/assignments/bulk',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({...selection,action,previewHash:preview.previewHash})});
      setAction(null);clear();notify(`${result.changed.toLocaleString()} assignments ${action==='unassign'?'unassigned':'reopened'}.`);refresh();
    } catch(error){setError(error instanceof Error?error.message:'Could not apply the change.');setPreview(null);}
    finally{setBusy(false);}
  }
  if(!hasSelection)return null;
  const verb=action==='unassign'?'Unassign':'Reopen';
  return <>
    <div className="assignment-bulk-bar"><SelectionSummary/><div className="assignment-bulk-actions" role="group" aria-label="Bulk assignment actions">
      <button type="button" className="btn-row" disabled={pending} onClick={()=>setAction('unassign')}>Unassign selected</button>
      <button type="button" className="btn-row" disabled={pending} onClick={()=>setAction('reopen')}>Reopen selected</button>
    </div></div>
    {action&&<Dialog title={`${verb} assignments`} busy={busy} onClose={()=>setAction(null)}>
      <div className="modal-body">
        {loading&&<p role="status">Checking the selected assignments…</p>}
        {preview&&<>
          <p><strong>{preview.eligible.toLocaleString()} of {preview.selected.toLocaleString()} assignments</strong> will be {action==='unassign'?'unassigned':'reopened'}.</p>
          <p>{action==='unassign'?'Open work will leave the caller’s queue. Notes, results and assignment history are kept.':'Completed work will return to the same caller’s queue. Existing notes and results are kept.'}</p>
          {!!(preview.skippedState+preview.skippedOwner+preview.skippedInactive+preview.skippedWarehouse)&&<ul className="bulk-skipped">
            {preview.skippedWarehouse>0&&<li>{preview.skippedWarehouse.toLocaleString()} skipped: numbers with warehouses already added to DB.</li>}
            {preview.skippedState>0&&<li>{preview.skippedState.toLocaleString()} skipped: {action==='unassign'?'not open':'not completed'}.</li>}
            {preview.skippedOwner>0&&<li>{preview.skippedOwner.toLocaleString()} skipped: the contact already has open work or is repeated in this selection.</li>}
            {preview.skippedInactive>0&&<li>{preview.skippedInactive.toLocaleString()} skipped: the caller no longer has access.</li>}
          </ul>}
        </>}
        {error&&<p role="alert">{error} <button type="button" className="btn-row" onClick={()=>setRetry(value=>value+1)}>Review again</button></p>}
      </div>
      <div className="modal-foot"><button type="button" className="btn-text" disabled={busy} onClick={()=>setAction(null)}>Cancel</button><button type="button" className="btn-primary" disabled={loading||busy||!preview?.eligible} onClick={()=>void apply()}>{busy?'Applying…':`${verb}${preview?` ${preview.eligible.toLocaleString()}`:''}`}</button></div>
    </Dialog>}
  </>;
}
