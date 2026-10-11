"use client";
import {useEffect,useState} from 'react';
import type {WalletBalance as Balance} from '@/lib/wallet';
import {dateTime} from '@/lib/display';
import {requestJson} from './requests';
export function WalletBalance({placeholder=false}:{placeholder?:boolean}){
 const [data,setData]=useState<Balance|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{if(placeholder)return;const controller=new AbortController();setLoading(true);setError('');requestJson<Balance>(`/api/balance${revision?'?refresh=1':''}`,{signal:controller.signal}).then(setData).catch(()=>{if(!controller.signal.aborted)setError('Could not load balance.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[revision,placeholder]);
 return <aside className="wallet-balance" aria-label="Bolna balance"><div className="wallet-readout"><strong>Bolna balance: </strong>{!data&&loading?<span role="status">Loading…</span>:data?.balance!=null?<><span>{data.balance.toLocaleString('en-IN',{maximumFractionDigits:4})} {data.unit}</span>{data.state==='stale'||error?<span className="review-tag">Stale</span>:null}{data.low&&<span className="review-tag">Low balance</span>}</>:<span>Unavailable</span>}</div>
  <button type="button" className="btn-row" disabled={loading} onClick={()=>setRevision(n=>n+1)}>Refresh balance</button>
  <small className="wallet-meta">{data?.refreshedAt?`Updated ${dateTime(data.refreshedAt)}`:loading?'Balance update time pending':'No balance update available'}{(error||data?.message)&&` · ${error||data?.message}`}</small>
 </aside>;
}
