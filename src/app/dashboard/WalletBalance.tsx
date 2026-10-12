"use client";
import {useEffect,useState} from 'react';
import type {WalletBalance as Balance} from '@/lib/wallet';
import {dateTime} from '@/lib/display';
import {requestJson} from './requests';
export function WalletBalance({placeholder=false,compact=false}:{placeholder?:boolean;compact?:boolean}){
 const [data,setData]=useState<Balance|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
 const [expanded,setExpanded]=useState(false);
 useEffect(()=>{if(placeholder)return;const controller=new AbortController();setLoading(true);setError('');requestJson<Balance>(`/api/balance${revision?'?refresh=1':''}`,{signal:controller.signal}).then(setData).catch(()=>{if(!controller.signal.aborted)setError('Could not load balance.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[revision,placeholder]);
 const refresh=<button type="button" className="btn-row" disabled={loading} onClick={()=>setRevision(n=>n+1)}>Refresh balance</button>;
 const meta=<small className="wallet-meta">{data?.refreshedAt?`Updated ${dateTime(data.refreshedAt)}`:loading?'Balance update time pending':'No balance update available'}{(error||data?.message)&&` · ${error||data?.message}`}</small>;
 return <aside className={`wallet-balance${compact?' wallet-compact':''}`} aria-label="Bolna balance"><div className="wallet-readout"><strong>Bolna balance: </strong>{!data&&loading?<span role="status">Loading…</span>:data?.balance!=null?<><span>{data.balance.toLocaleString('en-IN',{maximumFractionDigits:4})} {data.unit}</span>{data.state==='stale'||error?<span className="review-tag">Stale</span>:null}{data.low&&<span className="review-tag">Low balance</span>}</>:<span>Unavailable</span>}</div>
  {compact?<><button type="button" className="btn-text" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>Balance details</button>{expanded&&<div className="wallet-expanded">{meta}{refresh}</div>}</>:<>{refresh}{meta}</>}
 </aside>;
}
