export function pinClock(instant: string): () => void {
  const NativeDate = Date;
  const fixed = NativeDate.parse(instant);
  const started = performance.now();
  const current = () => fixed + (performance.now() - started);
  function PinnedDate(this: unknown, ...args: unknown[]) {
    if (!new.target) return new NativeDate(current()).toString();
    return args.length === 0 ? new NativeDate(current()) : Reflect.construct(NativeDate, args);
  }
  Object.setPrototypeOf(PinnedDate, NativeDate);
  PinnedDate.prototype = NativeDate.prototype;
  Object.defineProperty(PinnedDate, "now", { value: current, writable: true, configurable: true });
  globalThis.Date = PinnedDate as unknown as DateConstructor;
  return () => { globalThis.Date = NativeDate; };
}
