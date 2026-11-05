"use client";
import { countFilters, firstValue, type SearchValues } from "@/lib/filter-values";
import { BOARD_FILTER_LABELS, BOARD_PATH, UPDATED_WINDOWS } from "@/lib/board-filters";
import type { BoardFilterOptions } from "@/lib/board";
import { shortDate } from "@/lib/display";
import { FilterForm } from "../FilterForm";
import { FilterPanel } from "../FilterPanel";
import { FiltersToggle } from "../FiltersToggle";
import { ApplyButton } from "../ApplyButton";
import { MultiSelect } from "../MultiSelect";
import { SelectFilter } from "../FilterFields";

const WORK_KEYS = ["assignee", "assigned_by", "batch", "updated"];
const LOCATION_KEYS = ["city", "region"];

export function BoardFilters({ applied, options, isAdmin, action = BOARD_PATH, search = true }: {
  applied: SearchValues; options: BoardFilterOptions; isAdmin: boolean; action?: string; search?: boolean;
}) {
  const people = (list: { email: string; name: string | null }[]) => list.map(person => ({ value: person.email, label: person.name || person.email }));
  const batches = [{ value: "none", label: "No batch" }, ...options.batches.map(batch => ({
    value: batch.id, label: `${shortDate(batch.createdAt)} · ${batch.creatorName || batch.createdBy} · ${batch.tasks} ${batch.tasks === 1 ? "task" : "tasks"}`,
  }))];
  const names = new Map([...people(options.assignees), ...people(options.assigners), ...batches].map(choice => [choice.value, choice.label]));
  const formatValue = (key: string, value: string) => key === "updated" ? UPDATED_WINDOWS[value as keyof typeof UPDATED_WINDOWS] ?? value : names.get(value) ?? value;
  return <FilterForm key={JSON.stringify(applied)} action={action} applied={applied} className="board-filters" labels={BOARD_FILTER_LABELS} formatValue={formatValue}>
    {search && <div className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input type="search" name="q" defaultValue={firstValue(applied.q) || ""} aria-label="Search the board" placeholder="Search names, phones, notes…" />
    </div>}
    <FiltersToggle count={countFilters(applied, [...WORK_KEYS, ...LOCATION_KEYS])} />
    <ApplyButton />
    <FilterPanel groups={[
      { label: "Work", count: countFilters(applied, WORK_KEYS), content: <>
        {isAdmin && <MultiSelect name="assignee" label="Assigned to" value={applied.assignee} options={people(options.assignees)} />}
        <MultiSelect name="assigned_by" label="Assigned by" value={applied.assigned_by} options={people(options.assigners)} />
        <MultiSelect name="batch" label="Assignment batch" value={applied.batch} options={batches} />
        <SelectFilter name="updated" label="Last updated" applied={applied} any="Any time" options={Object.entries(UPDATED_WINDOWS).map(([value, label]) => ({ value, label }))} />
      </> },
      { label: "Location", count: countFilters(applied, LOCATION_KEYS), content: <>
        <MultiSelect name="city" label="City" value={applied.city} options={options.cities} />
        <MultiSelect name="region" label="State" value={applied.region} options={options.regions} />
      </> },
    ]} />
  </FilterForm>;
}
