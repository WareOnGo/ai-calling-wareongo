"use client";
import {useEffect,useRef} from 'react';
import {usePathname} from 'next/navigation';
import {ViewModeToggle} from './ViewModeToggle';
import {SignOutButton} from './SignOutButton';

export function AccountMenu({name,email,admin,canSwitch}:{name:string|null;email:string;admin:boolean;canSwitch:boolean}){
 const menu=useRef<HTMLDetailsElement>(null),path=usePathname(),display=name||email.split('@')[0];
 const initials=display.split(/[\s._-]+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
 useEffect(()=>{if(menu.current)menu.current.open=false;},[path]);
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(menu.current&&!menu.current.contains(event.target as Node))menu.current.open=false;};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&menu.current?.open){event.preventDefault();menu.current.open=false;menu.current.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[]);
 return <details className="account-menu" ref={menu}>
  <summary aria-label="Account menu"><span className="account-avatar" aria-hidden="true">{initials}</span><span className="account-caption"><strong>{display}</strong><span>{admin?'Admin view':'Employee view'}</span></span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
  <div className="account-panel"><div className="account-identity"><strong>{display}</strong><span>{email}</span></div>
   {canSwitch&&<div className="account-view"><span>Dashboard view</span><ViewModeToggle admin={admin}/></div>}
   <SignOutButton/>
  </div>
 </details>;
}
