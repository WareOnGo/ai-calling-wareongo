"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef } from "react";

export function Dialog({ title, onClose, busy = false, wide = false, drawer = false, children }: {
  title: React.ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; drawer?: boolean; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const id = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  return typeof document === "undefined" ? null : createPortal(<dialog ref={ref} tabIndex={-1} className={`app-dialog modal${wide ? "" : " confirm-modal"}${drawer ? " details-drawer" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} aria-busy={busy}
    onKeyDown={e => {
      if (e.key !== 'Tab') return;
      const elements = [...e.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],audio[controls],[tabindex]')].filter(el => !el.matches(':disabled') && el.tabIndex >= 0 && el.getClientRects().length > 0);
      if (!elements.length) {e.preventDefault();e.currentTarget.focus();return;}
      if (e.shiftKey && (document.activeElement === elements[0] || document.activeElement === e.currentTarget)) {e.preventDefault();elements.at(-1)!.focus();}
      if (!e.shiftKey && document.activeElement === elements.at(-1)) {e.preventDefault();elements[0].focus();}
    }}
    onCancel={e => { e.preventDefault(); if (!busy) closeRef.current(); }}
    onClick={e => { if (e.target === e.currentTarget && !busy) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeRef.current(); } }}>
    <div className="modal-head"><div id={id} className="modal-title">{title}</div><button type="button" className="modal-close" disabled={busy} aria-label="Close" onClick={onClose}>×</button></div>
    {children}
    {busy && <p className="operation-note" role="status">Please wait while this action finishes.</p>}
  </dialog>, document.body);
}
