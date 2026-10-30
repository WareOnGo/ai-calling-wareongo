export function WarehouseNotice({ ids }: { ids?: number[] }) {
  if (!ids?.length) return null;
  return <span className="pill pill-available" style={{display:'inline-flex',flexWrap:'wrap',gap:'0.3rem',whiteSpace:'normal'}} title={`Warehouse IDs: ${ids.join(', ')}`}>
    Warehouse already added to DB <small>WH {ids.join(', ')}</small>
  </span>;
}

function sameReferences(savedId: string | null | undefined, ids: number[]) {
  const saved = [...new Set((savedId || '').trim().split(/[,;\s]+/).filter(Boolean))];
  return saved.length === ids.length && ids.every(id => saved.includes(String(id)));
}

export function WarehouseMatchNote({ ids = [], savedId }: { ids?: number[]; savedId?: string | null }) {
  if (!ids.length) return null;
  return <small className="warehouse-reference-source" title="Matched by phone against the warehouse database">
    {sameReferences(savedId, ids) ? 'Matched in warehouse DB' : `DB matches: ${ids.join(', ')}`}
  </small>;
}

// Read-only WH ID cells retain saved references and show all phone matches in
// the same column. A blank saved field can display matches without choosing one.
export function WarehouseReference({ ids = [], savedId }: { ids?: number[]; savedId?: string | null }) {
  const saved = savedId?.trim();
  if (!saved && !ids.length) return <span className="muted">—</span>;
  const distinct = !!saved && ids.length > 0 && !sameReferences(saved, ids);
  return <div className="warehouse-reference">
    <span className="warehouse-reference-value">{distinct && <span className="muted">Saved: </span>}{saved || ids.join(', ')}</span>
    <WarehouseMatchNote ids={ids} savedId={saved || ids.join(', ')} />
  </div>;
}
