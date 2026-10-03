import type { BrowserContext, Page } from "@playwright/test";

export const FIXED_NOW = Date.parse("2026-09-28T12:00:00.000Z");

const pinnedContexts = new WeakSet<BrowserContext>();

export async function installFixedPageDate(page: Page, instant = FIXED_NOW) {
  const context = page.context();
  if (pinnedContexts.has(context)) return;
  pinnedContexts.add(context);
  await context.addInitScript((fixed) => {
    const NativeDate = Date;
    // oxlint-disable-next-line home/no-real-waits -- This shim advances the pinned page clock by real elapsed time, so it must read the native clock.
    const nativeNow = () => NativeDate.now();
    const anchorKey = "home:playwright-fixed-date-anchor";
    const started = nativeNow();
    let anchor = started;
    try {
      const stored = Number(sessionStorage.getItem(anchorKey));
      if (Number.isFinite(stored) && stored > 0 && stored <= started) anchor = stored;
      else sessionStorage.setItem(anchorKey, String(started));
    } catch {
      anchor = started;
    }
    const current = () => fixed + (nativeNow() - anchor);
    function FixedDate(this: unknown, ...args: unknown[]) {
      if (!new.target) return new NativeDate(current()).toString();
      const date: unknown = args.length === 0 ? new NativeDate(current()) : Reflect.construct(NativeDate, args);
      if (!(date instanceof NativeDate)) throw new TypeError("Date construction did not return a Date");
      return date;
    }
    Object.setPrototypeOf(FixedDate, NativeDate);
    FixedDate.prototype = NativeDate.prototype;
    Object.defineProperty(FixedDate, "now", { value: current, writable: true, configurable: true });
    globalThis.Date = FixedDate as unknown as DateConstructor;
  }, instant);
}
