import type { ReactNode } from "react";

export function RecordsHeader({ title, icon, actions, meta, tabs }: { title: string; icon?: ReactNode; actions?: ReactNode; meta?: ReactNode; tabs?: ReactNode }) {
  return <header className="records-header">
    <div className="records-heading"><div className="records-heading-top"><div className="page-title">{icon && <span className="pt-icon">{icon}</span>}{title}</div>{tabs}</div>{meta}</div>
    {actions && <div className="records-header-actions">{actions}</div>}
  </header>;
}
