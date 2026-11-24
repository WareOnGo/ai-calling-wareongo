import { createHash } from 'node:crypto';
import type { batchMembers, listBatches, BatchProgress, BatchRow } from './batch-browser';
import type { SearchValues } from './filter-values';

// Poll with the exact filters used by the page. Navigation helpers trim values,
// which would change exact-match agent/caller filters and cause refresh loops.
export function batchPollingQuery(values: SearchValues) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  return params.toString();
}

// Hash the data actually rendered, without another database read. Polls use the
// same scoped readers, so an intervening edit cannot be acknowledged by a token
// for data the page has never displayed. Object key order is not meaningful.
function version(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item,
  )).digest('hex');
}

export function batchCatalogVersion(data: Awaited<ReturnType<typeof listBatches>>, progress: Record<string, BatchProgress>, people: {email: string; name: string | null}[]) {
  return version({data, progress, people: people.map(({email, name}) => ({email, name}))});
}

export function batchDetailVersion(batch: BatchRow | null, data?: Awaited<ReturnType<typeof batchMembers>>) {
  return version({batch, data});
}
