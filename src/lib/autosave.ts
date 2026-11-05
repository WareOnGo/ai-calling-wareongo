export type Values = Record<string, string | boolean>;
export type SaveSnapshot<T extends Values> = {
  values: T;
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  error: string;
  field?: string;
  code?: string;
  dirty: boolean;
};

// One in-flight write per record. A new edit is compared with the last confirmed
// value after the previous request finishes, including edits back to the original.
export class Autosave<T extends Values> {
  private baseline: T;
  private desired: T;
  private failed: Partial<T> = {};
  private uncertain = new Set<keyof T>();
  private listeners = new Set<() => void>();
  private running = false;
  private requested = false;
  private code?: string;
  private snapshot: SaveSnapshot<T>;
  constructor(initial: T, private send: (patch: Partial<T>) => Promise<T | void>, private rollback: (keyof T)[] = [], private validationDrafts: (keyof T)[] = []) {
    this.baseline = { ...initial };
    this.desired = { ...initial };
    this.snapshot = { values: { ...initial }, status: "idle", error: "", dirty: false };
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  getDraft = (): Partial<T> => ({ ...this.diff(), ...this.failed });
  getBaseline = (): T => ({ ...this.baseline });
  private diff(): Partial<T> {
    return Object.fromEntries(Object.entries(this.desired).filter(([key, value]) => this.uncertain.has(key) || value !== this.baseline[key])) as Partial<T>;
  }
  private publish(status: SaveSnapshot<T>["status"], error = "", field: string | null | undefined = this.snapshot.field) {
    this.snapshot = { values: { ...this.desired }, status, error, field: field ?? undefined, code: this.code,
      dirty: this.running || Object.keys(this.diff()).length > 0 || Object.keys(this.failed).length > 0 };
    this.listeners.forEach(fn => fn());
  }
  set<K extends keyof T>(key: K, value: T[K], commit = false) {
    this.desired[key] = value;
    delete this.failed[key];
    this.publish(this.running ? "saving" : Object.keys(this.failed).length ? "error" : Object.keys(this.diff()).length ? "dirty" : "idle", this.snapshot.error);
    if (commit) void this.flush();
  }
  reconcile(values: T) {
    if (this.snapshot.dirty) return;
    if (Object.keys(values).every(key => values[key] === this.baseline[key])) return;
    this.baseline = { ...values }; this.desired = { ...values }; this.publish("idle");
  }
  // Only an explicit conflict review may replace a dirty baseline. Retain just
  // this user's edits, including checkbox/state intent rolled back after failure.
  rebase(values: T, keepDraft: boolean) {
    if (this.running) return;
    const draft = keepDraft ? this.getDraft() : {};
    this.baseline = { ...values };
    this.desired = { ...values, ...draft };
    this.failed = {}; this.uncertain.clear(); this.requested = false; this.code = undefined;
    this.publish(Object.keys(this.diff()).length ? "dirty" : "saved", "", null);
  }
  retry = () => {
    this.desired = { ...this.desired, ...this.failed };
    this.failed = {};
    void this.flush();
  };
  discard = () => {
    if (this.running) return;
    this.desired = { ...this.baseline }; this.failed = {}; this.uncertain.clear(); this.code = undefined; this.publish("idle", "", null);
  };
  async flush() {
    this.requested = true;
    if (this.running) return;
    // A failed field needs an explicit retry; saving another field must not erase it.
    while (this.requested) {
      this.requested = false;
      const patch = this.diff();
      for (const key of Object.keys(this.failed)) delete patch[key];
      if (!Object.keys(patch).length) return;
      const sentValues = { ...this.desired };
      this.running = true; this.publish("saving", this.snapshot.error);
      try {
        const confirmed = await this.send(patch);
        if (confirmed) {
          // Adopt server updates without erasing edits made while saving or
          // failed intent that still needs an explicit retry.
          for (const key of Object.keys(confirmed) as (keyof T)[]) {
            if (!(key in this.failed) && this.desired[key] === sentValues[key]) this.desired[key] = confirmed[key];
          }
          this.baseline = { ...confirmed };
        } else Object.assign(this.baseline, patch);
        Object.keys(patch).forEach(key => this.uncertain.delete(key));
        this.running = false;
        if (!Object.keys(this.failed).length) this.code = undefined;
        this.publish(Object.keys(this.failed).length ? "error" : Object.keys(this.diff()).length ? "dirty" : "saved", this.snapshot.error);
      } catch (error) {
        this.running = false;
        this.code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
        if (this.code === "ASSIGNMENT_CONFLICT") this.requested = false;
        const validationError=error instanceof Error && 'field' in error && !!error.field;
        const rejected = this.code === "ASSIGNMENT_CONFLICT" ? { ...patch, ...this.getDraft() } : patch;
        for (const key of Object.keys(rejected) as (keyof T)[]) {
          // A lost response may follow a successful database write. Send a later
          // restoration even when it equals the previously confirmed baseline.
          this.uncertain.add(key);
          if (this.desired[key] === rejected[key]) {
            this.failed[key] = rejected[key];
            // A dependent field (for example an Unclear closure reason) must
            // remain visible while the caller repairs a validation error.
            if (this.rollback.includes(key) && !(validationError && this.validationDrafts.includes(key))) this.desired[key] = this.baseline[key];
          }
        }
        this.publish("error", error instanceof Error ? error.message : "Couldn't save. Try again.", error instanceof Error && "field" in error ? String(error.field) : undefined);
      }
    }
  }
}
