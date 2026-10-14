import type { ReactNode } from "react";

export function RecordsHeader({ title, icon, actions, meta, tabs, status }: { title: string; icon?: ReactNode; actions?: ReactNode; meta?: ReactNode; tabs?: ReactNode; status?: ReactNode }) {
  return <header className="records-header">
    <div className="records-heading"><div className="records-heading-top"><h1 className="page-title">{icon && <span className="pt-icon">{icon}</span>}{title}</h1>{status && <span className="title-sub">{status}</span>}{tabs}</div>{meta}</div>
    {actions && <div className="records-header-actions">{actions}</div>}
  </header>;
}
