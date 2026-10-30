import Link from "next/link";
import { searchQuery, type SearchValues } from "@/lib/filter-values";
import { PageJump } from "./PageJump";

export function RecordsPagination({ page, pages, total, pageSize, applied, empty = "No results", label = "Results pages" }: {
  page: number; pages: number; total: number; pageSize: number; applied: SearchValues; empty?: string; label?: string;
}) {
  const start = (page - 1) * pageSize;
  const href = (target: number) => `?${searchQuery({ ...applied, page: String(target) })}`;
  const control = (target: number, name: string, text: string, disabled: boolean, edge = false) => {
    const props = { className: `pagination-button${edge ? " pagination-edge" : ""}`, "aria-label": name, title: `${name} page` };
    return disabled ? <button type="button" {...props} disabled>{text}</button> : <Link {...props} href={href(target)}>{text}</Link>;
  };
  return <footer className="records-pagination">
    <span className="pagination-count">{total ? `${(start + 1).toLocaleString()}–${Math.min(start + pageSize, total).toLocaleString()} of ${total.toLocaleString()}` : empty}</span>
    <nav className="pagination-controls" aria-label={label}>
      {control(1, "First", "«", page <= 1, true)}
      {control(page - 1, "Previous", "Previous", page <= 1)}
      <PageJump key={page} page={page} pages={pages} compact />
      {control(page + 1, "Next", "Next", page >= pages)}
      {control(pages, "Last", "»", page >= pages, true)}
    </nav>
  </footer>;
}
