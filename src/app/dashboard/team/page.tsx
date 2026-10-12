import Link from "next/link";
import { parseTeamFilters } from "@/lib/team-report";
import { firstValue, type SearchValues } from "@/lib/filter-values";
import { requireAdmin } from "@/lib/auth";
import { TeamReport } from "./TeamReport";
import { TeamHeader } from "./TeamHeader";

export const dynamic = "force-dynamic";

// Keep existing report URLs and their date/metric filters shareable.
export default async function TeamPerformance({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  let filters;
  try {
    filters = parseTeamFilters(Object.fromEntries(Object.entries(sp).map(([key, value]) => [key, firstValue(value)])));
  } catch (error) {
    return <><TeamHeader view="performance"/><div className="team-page"><p role="alert">Invalid report range. {error instanceof Error ? error.message : "Check the dates."} <Link href="/dashboard/team">Reset report</Link></p></div></>;
  }
  return <><TeamHeader view="performance"/><div className="team-page"><TeamReport viewer={viewer} filters={filters} showEvidence={!!firstValue(sp.metric)}/></div></>;
}
