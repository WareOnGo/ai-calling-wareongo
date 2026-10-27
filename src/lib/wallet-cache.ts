import type { WalletBalance } from './wallet';

const INITIAL = { data: null as WalletBalance | null, error: '', loading: true };
/** One cache per signed-in dashboard, shared by header and calling dialog. */
export function createWalletCache(fetchBalance: (refresh: boolean) => Promise<WalletBalance>) {
  let snapshot = INITIAL, pending: Promise<void> | null = null, attemptedAt = 0;
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load(refresh = false) {
      if (pending) return pending;
      if (!refresh && attemptedAt && Date.now() - attemptedAt < 60_000) return Promise.resolve();
      publish({ ...snapshot, loading: true, error: '' });
      pending = fetchBalance(refresh)
        .then(data => publish({ data, error: '', loading: false }))
        .catch(() => publish({ ...snapshot, error: 'Could not load balance.', loading: false }))
        .finally(() => { attemptedAt = Date.now(); pending = null; });
      return pending;
    },
  };
}
