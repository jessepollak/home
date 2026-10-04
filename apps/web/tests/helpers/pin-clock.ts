function installClock(instant: string, advancing: boolean): { set(epochMs: number): void; restore(): void } {
  const NativeDate = Date;
  let fixed = NativeDate.parse(instant);
  const started = performance.now();
  let active = true;
  const current = () => fixed + (advancing ? performance.now() - started : 0);
  function PinnedDate(this: unknown, ...args: unknown[]) {
    if (!new.target) return new NativeDate(current()).toString();
    const date: unknown = args.length === 0 ? new NativeDate(current()) : Reflect.construct(NativeDate, args);
    if (!(date instanceof NativeDate)) throw new TypeError("Date construction did not return a Date");
    return date;
  }
  Object.setPrototypeOf(PinnedDate, NativeDate);
  PinnedDate.prototype = NativeDate.prototype;
  Object.defineProperty(PinnedDate, "now", { value: current, writable: true, configurable: true });
  globalThis.Date = PinnedDate as unknown as DateConstructor;
  return {
    set(epochMs: number) { if (active) fixed = epochMs; },
    restore() {
      if (!active) return;
      active = false;
      globalThis.Date = NativeDate;
    },
  };
}

export function pinClock(instant: string): () => void {
  return installClock(instant, true).restore;
}

export function holdClock(instant: string): { set(epochMs: number): void; restore(): void } {
  return installClock(instant, false);
}
