import { afterEach, expect, it, vi } from 'vitest';
import { createWalletCache } from './wallet-cache';
import type { WalletBalance } from './wallet';
const balance: WalletBalance = { balance: 27.79, unit: 'USD', state: 'fresh', refreshedAt: '2026-10-14T00:00:00Z', low: false, message: null };
afterEach(() => vi.useRealTimers());

it('coalesces mounts, reuses a fresh balance, and publishes an explicit refresh to all consumers', async () => {
  let resolve!: (value: WalletBalance) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<WalletBalance>(done => { resolve = done; })).mockResolvedValue({ ...balance, balance: 26 });
  const cache = createWalletCache(fetch), listener = vi.fn();
  const unsubscribe = cache.subscribe(listener);
  const first = cache.load(); expect(cache.load()).toBe(first); expect(cache.load(true)).toBe(first);
  resolve(balance); await first; await cache.load();
  expect(fetch).toHaveBeenCalledTimes(1); expect(cache.getSnapshot().data).toEqual(balance);
  await cache.load(true); expect(fetch).toHaveBeenLastCalledWith(true);
  expect(cache.getSnapshot().data?.balance).toBe(26); expect(listener).toHaveBeenCalled();
  unsubscribe(); listener.mockClear(); await cache.load(true); expect(listener).not.toHaveBeenCalled();
});

it('expires data and retains the last balance when a refresh fails, with a working retry', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(balance).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...balance, balance: 25 });
  const cache = createWalletCache(fetch);
  await cache.load(); vi.advanceTimersByTime(60_001); await cache.load();
  expect(cache.getSnapshot()).toMatchObject({ data: balance, error: 'Could not load balance.', loading: false });
  await cache.load(true); expect(cache.getSnapshot()).toMatchObject({ data: { balance: 25 }, error: '', loading: false });
});

it('does not share data across dashboard identities', async () => {
  const first = createWalletCache(async () => balance), second = createWalletCache(async () => ({ ...balance, balance: 10 }));
  await first.load(); expect(second.getSnapshot().data).toBeNull();
  await second.load(); expect(first.getSnapshot().data?.balance).toBe(27.79); expect(second.getSnapshot().data?.balance).toBe(10);
});
