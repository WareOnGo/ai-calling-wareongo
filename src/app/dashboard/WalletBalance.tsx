"use client";
import {createContext,useContext,useEffect,useId,useMemo,useSyncExternalStore,type ReactNode} from 'react';
import type {WalletBalance as Balance} from '@/lib/wallet';
import {createWalletCache} from '@/lib/wallet-cache';
import {dateTime} from '@/lib/display';
import {requestJson} from './requests';
const dollars = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'});
const WalletContext = createContext<ReturnType<typeof createWalletCache> | null>(null);
export function WalletBalanceProvider({scope,children}:{scope:string;children:ReactNode}) {
 const cache=useMemo(()=>createWalletCache(refresh=>requestJson<Balance>(`/api/balance${refresh?'?refresh=1':''}`)),[scope]);
 return <WalletContext.Provider value={cache}>{children}</WalletContext.Provider>;
}
export function WalletBalance({placeholder=false}:{placeholder?:boolean;compact?:boolean}){
 const cache=useContext(WalletContext);
 if(!cache)throw new Error('WalletBalanceProvider is required');
 const {data,error,loading}=useSyncExternalStore(cache.subscribe,cache.getSnapshot,cache.getServerSnapshot);
 const descriptionId=useId();
 useEffect(()=>{if(!placeholder)void cache.load();},[cache,placeholder]);
 const details=[data?.refreshedAt?`Updated ${dateTime(data.refreshedAt)}`:'No balance update available',error||data?.message].filter(Boolean).join(' · ');
 const stale=data?.state==='stale'||!!error&&data?.balance!=null;
 return <aside className="wallet-balance" aria-label="Bolna balance" title={details}>
  <span className="wallet-readout" role="status" aria-live="polite"><span>Bolna balance</span><strong>{!data&&loading?'Loading…':data?.balance!=null?`${dollars.format(data.balance)} USD`:'Unavailable'}</strong>{stale&&<span className="wallet-state">Stale</span>}{data?.low&&<span className="wallet-state">Low balance</span>}</span>
  <button type="button" className="wallet-refresh" aria-label="Refresh balance" aria-describedby={descriptionId} title={loading?'Refreshing balance…':`Refresh balance · ${details}`} disabled={loading||placeholder} onClick={()=>void cache.load(true)}>
   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3a7 7 0 0 0 11.5-1"/></svg>
  </button>
  <span className="sr-only" id={descriptionId}>{details}</span>
 </aside>;
}
