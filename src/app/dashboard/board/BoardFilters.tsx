"use client";
import { useId, useState } from "react";
import { countFilters, firstValue, type SearchValues } from "@/lib/filter-values";
import { BOARD_FILTER_LABELS, BOARD_PATH, FOLLOW_UPS, UPDATED_WINDOWS, WORK_TYPES } from "@/lib/board-filters";
import type { BoardFilterOptions } from "@/lib/board";
import { shortDate } from "@/lib/display";
import { FilterForm } from "../FilterForm";
import { ApplyButton } from "../ApplyButton";
import { IconFilter } from "../icons";

// As on My Work: quick filters stay visible; the rest sit behind "More filters".
const MORE_KEYS = ["city", "region", "assigned_by", "batch", "updated"];

type Choice = { value: string; label: string };
const choices = (labels: Record<string, string>): Choice[] => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** One labelled dropdown chip, as on My Work; the first option clears the filter. */
function Chip({ name, label, any, options, applied }: { name: string; label: string; any: string; options: Choice[]; applied: SearchValues }) {
  const selected = firstValue(applied[name]) || "";
  const list = selected && !options.some(option => option.value === selected) ? [...options, { value: selected, label: selected }] : options;
  return <label className={`work-filter chip${selected ? " active" : ""}`}><span>{label}</span>
    <select name={name} aria-label={label} defaultValue={selected}>
      <option value="">{any}</option>{list.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

/**
 * The board's filters are dropdowns in the toolbar, like My Work's. Only the admin
 * funnel offers the caller (assignee) filter; the board itself is personal. Hidden
 * "more" filters stay in the form, so applying one filter never drops another.
 */
export function BoardFilters({ applied, options, showAssignee = false, action = BOARD_PATH, search = true }: {
  applied: SearchValues; options: BoardFilterOptions; showAssignee?: boolean; action?: string; search?: boolean;
}) {
  const people = (list: { email: string; name: string | null }[]) => list.map(person => ({ value: person.email, label: person.name || person.email }));
  const batches = [{ value: "none", label: "No batch" }, ...options.batches.map(batch => ({
    value: batch.id, label: `${shortDate(batch.createdAt)} · ${batch.creatorName || batch.createdBy} · ${batch.tasks} ${batch.tasks === 1 ? "task" : "tasks"}`,
  }))];
  const names = new Map([...people(options.assignees), ...people(options.assigners), ...batches].map(choice => [choice.value, choice.label]));
  const fixed: Record<string, Record<string, string>> = { updated: UPDATED_WINDOWS, type: WORK_TYPES, follow_up: FOLLOW_UPS };
  const formatValue = (key: string, value: string) => fixed[key]?.[value] ?? names.get(value) ?? value;
  const plain = (values: string[]) => values.map(value => ({ value, label: value }));
  const moreCount = countFilters(applied, MORE_KEYS);
  const [more, setMore] = useState(moreCount > 0);
  const moreId = useId();
  return <FilterForm key={JSON.stringify(applied)} action={action} applied={applied} className="board-filters" labels={BOARD_FILTER_LABELS} formatValue={formatValue}>
    {search && <div className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input type="search" name="q" defaultValue={firstValue(applied.q) || ""} aria-label="Search the board" placeholder="Search names, phones, notes…" />
    </div>}
    {showAssignee && <Chip name="assignee" label="Assigned to" any="Everyone" options={people(options.assignees)} applied={applied} />}
    <Chip name="type" label="Work type" any="All work" options={choices(WORK_TYPES)} applied={applied} />
    <Chip name="follow_up" label="Follow-up" any="Any" options={choices(FOLLOW_UPS)} applied={applied} />
    <button type="button" className={`filters-toggle${moreCount ? " active" : ""}`} aria-expanded={more} aria-controls={moreId} onClick={() => setMore(open => !open)}>
      <IconFilter size={15} />More filters{moreCount > 0 && <span className="fbadge">{moreCount}</span>}
    </button>
    <ApplyButton />
    <div id={moreId} className="board-more-filters" hidden={!more}>
      <Chip name="city" label="City" any="All cities" options={plain(options.cities)} applied={applied} />
      <Chip name="region" label="State" any="All states" options={plain(options.regions)} applied={applied} />
      <Chip name="assigned_by" label="Assigned by" any="Anyone" options={people(options.assigners)} applied={applied} />
      <Chip name="batch" label="Assignment batch" any="All batches" options={batches} applied={applied} />
      <Chip name="updated" label="Last updated" any="Any time" options={choices(UPDATED_WINDOWS)} applied={applied} />
    </div>
  </FilterForm>;
}
