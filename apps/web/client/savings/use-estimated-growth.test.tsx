import "@/client/account/dom-test-harness";

import { afterAll, afterEach, describe, expect, jest, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import type { SavingsPortfolioSummary } from "./portfolio-summary";
import { estimateSavingsGrowthBaseUnits } from "./estimated-growth";
import { createSavingsGrowthAnchor, useEstimatedSavingsGrowth, type SavingsGrowthAnchor, type SavingsGrowthAuthority } from "./use-estimated-growth";

let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

const originalMatchMedia = window.matchMedia;
let reducedMotion = false;
const reducedMotionListeners = new Set<EventListenerOrEventListenerObject>();
const reducedMotionMedia = {
  get matches() { return reducedMotion; },
  media: "(prefers-reduced-motion: reduce)",
  onchange: null,
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "change") reducedMotionListeners.add(listener);
  },
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "change") reducedMotionListeners.delete(listener);
  },
  addListener(listener: EventListenerOrEventListenerObject) { reducedMotionListeners.add(listener); },
  removeListener(listener: EventListenerOrEventListenerObject) { reducedMotionListeners.delete(listener); },
  dispatchEvent: () => true,
} as MediaQueryList;
window.matchMedia = (() => reducedMotionMedia) as typeof window.matchMedia;

function setReducedMotion(next: boolean) {
  reducedMotion = next;
  const event = new Event("change");
  for (const listener of reducedMotionListeners) {
    if (typeof listener === "function") listener(event);
    else listener.handleEvent(event);
  }
}

function anchor(identity: string, amount: bigint, t0: number): SavingsGrowthAnchor {
  return {
    identity,
    authoritativeBaseUnits: amount,
    estimate: {
      authoritativeBaseUnits: amount,
      apy: { numerator: BigInt(1), denominator: BigInt(10) },
      snapshotTimeMs: t0,
      eligibleUntilMs: t0 + 300_000,
    },
  };
}

function Harness({ value, now }: { value: SavingsGrowthAnchor; now: () => number }) {
  return <output>{useEstimatedSavingsGrowth(value, now).toString()}</output>;
}

afterEach(() => {
  hidden = false;
  reducedMotion = false;
  reducedMotionListeners.clear();
  jest.useRealTimers();
  cleanup();
});
afterAll(() => {
  window.matchMedia = originalMatchMedia;
});

const authority: SavingsGrowthAuthority = { accountIdentity: "owner", assetIdentity: "usdc", blockNumber: "1", blockHash: "0x1", blockTimestamp: "2000000000", snapshotStale: false, registryCoverageComplete: true };
const candidate = { vaultAddress: "0xvault", netApy: 0.1, stateAsOf: "2033-05-18T03:33:00.000Z", source: { fetchedAt: "2033-05-18T03:33:00.000Z" } } as unknown as MorphoVaultCandidate;
const summary: SavingsPortfolioSummary = { balance: { status: "available", asset: { address: "usdc", symbol: "USDC", decimals: 6 }, totalBaseUnits: "100" }, apy: { status: "available", value: { numerator: BigInt(1), denominator: BigInt(10) } }, funded: true, vaults: [{ vaultAddress: "0xvault", balanceBaseUnits: "100" }] };
function built(overrides: { authority?: Partial<SavingsGrowthAuthority>; candidates?: MorphoVaultCandidate[]; summary?: SavingsPortfolioSummary } = {}) {
  return createSavingsGrowthAnchor({ authority: { ...authority, ...overrides.authority }, candidates: overrides.candidates ?? [candidate], metadataFetchedAt: "2033-05-18T03:33:00.000Z", metadataStale: false, nowMs: 2_000_000_060_000, summary: overrides.summary ?? summary });
}

describe("Save estimated-growth owner", () => {
  test("anchor identity follows authority, funded composition, and rates but not unfunded selection", () => {
    const base = built().identity;
    for (const authorityChange of [{ accountIdentity: "other" }, { assetIdentity: "other" }, { blockNumber: "2" }, { blockHash: "0x2" }]) expect(built({ authority: authorityChange }).identity).not.toBe(base);
    expect(built({ candidates: [{ ...candidate, netApy: 0.2 }] }).identity).not.toBe(base);
    expect(built({ summary: { ...summary, balance: { status: "available", asset: { address: "usdc", symbol: "USDC", decimals: 6 }, totalBaseUnits: "101" }, vaults: [{ vaultAddress: "0xvault", balanceBaseUnits: "101" }] } }).identity).not.toBe(base);
    expect(built({ candidates: [candidate, { ...candidate, vaultAddress: "0xselected", netApy: 0.9 }] }).identity).toBe(base);
  });

  test("anchor disables estimates for stale, incomplete, missing, partial, and malformed inputs", () => {
    const partial = { ...summary, apy: { status: "partial", value: null } } as SavingsPortfolioSummary;
    const staleRate = { ...summary, apy: { status: "stale", value: summary.apy.value } } as SavingsPortfolioSummary;
    const malformed = { ...summary, apy: { status: "available", value: { numerator: BigInt(11), denominator: BigInt(1) } } } as SavingsPortfolioSummary;
    expect([built({ authority: { snapshotStale: true } }), built({ authority: { registryCoverageComplete: false } }), built({ candidates: [] }), built({ summary: partial }), built({ summary: staleRate }), built({ summary: malformed })].every((value) => value.estimate === null)).toBe(true);
  });
  test("does not schedule while initially hidden and resumes with one immediate recomputation", () => {
    jest.useFakeTimers();
    hidden = true;
    const wall = 2_000_000_060_000;
    const now = jest.fn(() => wall);
    const view = render(<Harness value={anchor("a", BigInt("1000000000000000000"), wall - 60_000)} now={now} />);
    expect(view.container.textContent).toBe("1000000000000000000");
    void act(() => jest.advanceTimersByTime(1_000));
    expect(now).toHaveBeenCalledTimes(0);

    hidden = false;
    void act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(now).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).not.toBe("1000000000000000000");
  });

  test("closes a queued callback race while hidden and expires to B0 on resume", () => {
    jest.useFakeTimers();
    let wall = 2_000_000_060_000;
    const now = jest.fn(() => wall);
    const value = anchor("a", BigInt("1000000000000000000"), wall - 60_000);
    value.estimate!.eligibleUntilMs = wall + 100;
    const view = render(<Harness value={value} now={now} />);

    hidden = true;
    wall += 500;
    void act(() => jest.advanceTimersByTime(250));
    expect(now).toHaveBeenCalledTimes(0);
    hidden = false;
    void act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(now).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe("1000000000000000000");
  });

  test("recomputes every displayed estimate from the authoritative base units", () => {
    jest.useFakeTimers();
    let wall = 2_000_000_060_000;
    const value = anchor("authoritative", BigInt("1000000000000000000"), wall - 60_000);
    const view = render(<Harness value={value} now={() => wall} />);

    void act(() => jest.advanceTimersByTime(250));
    expect(view.container.textContent).toBe(
      estimateSavingsGrowthBaseUnits(value.estimate!, wall).toString(),
    );

    wall += 60_000;
    void act(() => jest.advanceTimersByTime(250));
    expect(view.container.textContent).toBe(
      estimateSavingsGrowthBaseUnits(value.estimate!, wall).toString(),
    );
  });

  test("reconciles higher and lower identities synchronously without a stale frame", () => {
    jest.useFakeTimers();
    const wall = 2_000_000_060_000;
    const now = () => wall;
    const view = render(<Harness value={anchor("a", BigInt("1000000000000000000"), wall - 60_000)} now={now} />);
    void act(() => jest.advanceTimersByTime(250));
    expect(view.container.textContent).not.toBe("1000000000000000000");

    view.rerender(<Harness value={anchor("higher", BigInt("2000000000000000000"), wall)} now={now} />);
    expect(view.container.textContent).toBe("2000000000000000000");
    view.rerender(<Harness value={anchor("lower", BigInt("500000000000000000"), wall)} now={now} />);
    expect(view.container.textContent).toBe("500000000000000000");
  });

  test("keeps an estimate across non-identity rerenders and cleans timers and listeners", () => {
    jest.useFakeTimers();
    const add = jest.spyOn(document, "addEventListener");
    const remove = jest.spyOn(document, "removeEventListener");
    const now = jest.fn(() => 2_000_000_060_000);
    const value = anchor("stable", BigInt("1000000000000000000"), 2_000_000_000_000);
    const view = render(<Harness value={value} now={now} />);
    void act(() => jest.advanceTimersByTime(250));
    const grown = view.container.textContent;
    view.rerender(<Harness value={{ ...value }} now={now} />);
    expect(view.container.textContent).toBe(grown);
    view.unmount();
    expect(add.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);
    expect(remove.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);
    const callsAtUnmount = now.mock.calls.length;
    void act(() => jest.advanceTimersByTime(1_000));
    expect(now).toHaveBeenCalledTimes(callsAtUnmount);
    add.mockRestore();
    remove.mockRestore();
  });

  test("displays the authoritative value without sampling for ineligible estimates or reduced motion", () => {
    jest.useFakeTimers();
    const wall = 2_000_000_060_000;
    const amount = BigInt("1000000000000000000");
    const ineligible: SavingsGrowthAnchor = { identity: "ineligible", authoritativeBaseUnits: amount, estimate: null };
    const cases = [
      { name: "eligible with normal motion", reducedMotion: false, value: anchor("eligible", amount, wall - 60_000), samples: 1, displayed: "estimate" },
      { name: "eligible with reduced motion", reducedMotion: true, value: anchor("eligible", amount, wall - 60_000), samples: 0, displayed: "authoritative" },
      { name: "ineligible with normal motion", reducedMotion: false, value: ineligible, samples: 0, displayed: "authoritative" },
      { name: "ineligible with reduced motion", reducedMotion: true, value: ineligible, samples: 0, displayed: "authoritative" },
    ] as const;

    for (const entry of cases) {
      setReducedMotion(entry.reducedMotion);
      const now = jest.fn(() => wall);
      const view = render(<Harness value={entry.value} now={now} />);
      expect(view.container.textContent, entry.name).toBe(amount.toString());
      void act(() => jest.advanceTimersByTime(250));
      expect(now.mock.calls.length, entry.name).toBe(entry.samples);
      expect(view.container.textContent, entry.name).toBe(
        entry.displayed === "estimate"
          ? estimateSavingsGrowthBaseUnits(entry.value.estimate!, wall).toString()
          : amount.toString(),
      );
      view.unmount();
    }
  });

  test("follows a runtime preference change without redisplaying a sample captured before it", () => {
    jest.useFakeTimers();
    let wall = 2_000_000_060_000;
    const amount = BigInt("1000000000000000000");
    const now = jest.fn(() => wall);
    const value = anchor("runtime", amount, wall - 60_000);
    const view = render(<Harness value={value} now={now} />);

    void act(() => jest.advanceTimersByTime(250));
    const grown = estimateSavingsGrowthBaseUnits(value.estimate!, wall).toString();
    expect(view.container.textContent).toBe(grown);

    act(() => setReducedMotion(true));
    expect(view.container.textContent).toBe(amount.toString());
    void act(() => jest.advanceTimersByTime(1_000));
    void act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(view.container.textContent).toBe(amount.toString());
    expect(now).toHaveBeenCalledTimes(1);

    wall += 60_000;
    act(() => setReducedMotion(false));
    expect(view.container.textContent).toBe(amount.toString());
    void act(() => jest.advanceTimersByTime(250));
    expect(now).toHaveBeenCalledTimes(2);
    const resumed = estimateSavingsGrowthBaseUnits(value.estimate!, wall).toString();
    expect(view.container.textContent).toBe(resumed);
    expect(resumed).not.toBe(grown);
  });
});
