"use client";
import { useState, type ReactNode } from "react";
export function BatchFilters({children}:{children:ReactNode}){
  const [dirty,setDirty]=useState(false);
  return <form className={`filterbar batch-filters${dirty?' has-changes':''}`} method="GET" onChange={()=>setDirty(true)}>{children}</form>;
}
