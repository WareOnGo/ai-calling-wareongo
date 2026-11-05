// URL contract for the caller board: filters and per-column card limits.
// Every value is validated here, before it reaches SQL.
import { filterValues, searchQuery, type FilterValue, type SearchValues } from "./filter-values";
import { STAGE_SLUGS, type Stage } from "./board-stages";

export const BOARD_PATH = "/dashboard/board";
export const BOARD_PAGE_SIZE = 50;
export const BOARD_MAX_CARDS = 500;
export const UPDATED_WINDOWS = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" } as const;
export type UpdatedWindow = keyof typeof UPDATED_WINDOWS;
export const WORK_TYPES = { record: "Listings", call: "AI follow-ups" } as const;
export const FOLLOW_UPS = { overdue: "Overdue", upcoming: "Upcoming", none: "Not set" } as const;

export type BoardFilters = {
  q?: string; city?: string[]; region?: string[]; assigned_by?: string[];
  batch?: string[]; updated?: UpdatedWindow; assignee?: string[];
  type?: keyof typeof WORK_TYPES; follow_up?: keyof typeof FOLLOW_UPS;
};
export type ColumnLimits = Partial<Record<Stage, number>>;

export const BOARD_FILTER_LABELS: Record<keyof BoardFilters, string> = {
  q: "Search", city: "City", region: "State", assigned_by: "Assigned by", batch: "Assignment batch", updated: "Last updated", assignee: "Assigned to",
  type: "Work type", follow_up: "Follow-up",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (value: FilterValue, normalize = (v: string) => v) => {
  const values = [...new Set(filterValues(value).map(normalize))];
  return values.length ? values : undefined;
};
const limitKey = (stage: Stage) => `${stage}_cards`;

/** Assignee is an admin-only filter; employees always see exactly their own work. */
export function parseBoardFilters(params: SearchValues, viewer: { isAdmin: boolean }): BoardFilters {
  const filters: BoardFilters = {};
  const q = filterValues(params.q)[0];
  if (q) filters.q = q.slice(0, 200);
  const city = list(params.city), region = list(params.region), assignedBy = list(params.assigned_by, v => v.toLowerCase());
  if (city) filters.city = city;
  if (region) filters.region = region;
  if (assignedBy) filters.assigned_by = assignedBy;
  const batch = list(params.batch, v => v.toLowerCase())?.filter(v => v === "none" || UUID.test(v));
  if (batch?.length) filters.batch = batch;
  const updated = filterValues(params.updated)[0];
  if (updated && Object.hasOwn(UPDATED_WINDOWS, updated)) filters.updated = updated as UpdatedWindow;
  const type = filterValues(params.type)[0];
  if (type && Object.hasOwn(WORK_TYPES, type)) filters.type = type as keyof typeof WORK_TYPES;
  const followUp = filterValues(params.follow_up)[0];
  if (followUp && Object.hasOwn(FOLLOW_UPS, followUp)) filters.follow_up = followUp as keyof typeof FOLLOW_UPS;
  const assignee = viewer.isAdmin ? list(params.assignee, v => v.toLowerCase()) : undefined;
  if (assignee) filters.assignee = assignee;
  return filters;
}

/** "Show more" grows a column in whole pages; anything else falls back to one page. */
export function parseColumnLimits(params: SearchValues): ColumnLimits {
  const limits: ColumnLimits = {};
  for (const stage of STAGE_SLUGS) {
    const raw = filterValues(params[limitKey(stage)])[0];
    if (!raw || !/^\d+$/.test(raw)) continue;
    const requested = Number(raw);
    if (requested <= BOARD_PAGE_SIZE) continue;
    limits[stage] = Math.min(BOARD_MAX_CARDS, Math.ceil(requested / BOARD_PAGE_SIZE) * BOARD_PAGE_SIZE);
  }
  return limits;
}

export const hasBoardCriteria = (filters: BoardFilters) => Object.values(filters).some(value => Array.isArray(value) ? value.length > 0 : !!value);

export function boardSearchValues(filters: BoardFilters, limits: ColumnLimits = {}): SearchValues {
  const values: SearchValues = { ...filters };
  for (const stage of STAGE_SLUGS) {
    const limit = limits[stage];
    if (limit && limit > BOARD_PAGE_SIZE) values[limitKey(stage)] = String(limit);
  }
  return values;
}

export function boardHref(filters: BoardFilters, limits: ColumnLimits = {}, path = BOARD_PATH) {
  const params = searchQuery(boardSearchValues(filters, limits));
  return `${path}${params.size ? `?${params}` : ""}`;
}
