import type { WorkItem } from "@/lib/personal-work";

const labels = { city: "City", area: "Area", rent: "Rent" };

export function WorkContext({ context, loading = false }: { context?: WorkItem["context"]; loading?: boolean }) {
  const facts = (Object.keys(labels) as (keyof typeof labels)[]).filter(key => {
    const value = context?.[key]?.trim();
    return loading || (value && value !== "—" && value !== "-");
  });
  if (!facts.length) return null;
  return <dl className="work-context" aria-label="Property details">
    {facts.map(key => <div className="work-fact" key={key}>
      <dt>{labels[key]}</dt>
      <dd>{loading ? <span className="skeleton" style={{ width: key === "area" ? 70 : 55, height: 11 }} /> : context?.[key]}</dd>
    </div>)}
  </dl>;
}
