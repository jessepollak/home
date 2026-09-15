import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { MorphoVaultCandidate } from "@/shared/savings/types";
import type { SavingsPortfolioSummary } from "./portfolio-summary";
import { createSavingsGrowthAnchor, useEstimatedSavingsGrowth, type SavingsGrowthAnchor, type SavingsGrowthAuthority } from "./use-estimated-growth";

let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

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
  jest.useRealTimers();
  cleanup();
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
    const malformed = { ...summary, apy: { status: "available", value: { numerator: BigInt(11), denominator: BigInt(1) } } } as SavingsPortfolioSummary;
    expect([built({ authority: { snapshotStale: true } }), built({ authority: { registryCoverageComplete: false } }), built({ candidates: [] }), built({ summary: partial }), built({ summary: malformed })].every((value) => value.estimate === null)).toBe(true);
  });
  test("does not schedule while initially hidden and resumes with one immediate recomputation", () => {
    jest.useFakeTimers();
    hidden = true;
    const wall = 2_000_000_060_000;
    const now = jest.fn(() => wall);
    const view = render(<Harness value={anchor("a", BigInt("1000000000000000000"), wall - 60_000)} now={now} />);
    expect(view.container.textContent).toBe("1000000000000000000");
    act(() => jest.advanceTimersByTime(1_000));
    expect(now).toHaveBeenCalledTimes(0);

    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
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
    act(() => jest.advanceTimersByTime(250));
    expect(now).toHaveBeenCalledTimes(0);
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(now).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe("1000000000000000000");
  });

  test("reconciles higher and lower identities synchronously without a stale frame", () => {
    jest.useFakeTimers();
    const wall = 2_000_000_060_000;
    const now = () => wall;
    const view = render(<Harness value={anchor("a", BigInt("1000000000000000000"), wall - 60_000)} now={now} />);
    act(() => jest.advanceTimersByTime(250));
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
    act(() => jest.advanceTimersByTime(250));
    const grown = view.container.textContent;
    view.rerender(<Harness value={{ ...value }} now={now} />);
    expect(view.container.textContent).toBe(grown);
    view.unmount();
    expect(add.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);
    expect(remove.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);
    const callsAtUnmount = now.mock.calls.length;
    act(() => jest.advanceTimersByTime(1_000));
    expect(now).toHaveBeenCalledTimes(callsAtUnmount);
    add.mockRestore();
    remove.mockRestore();
  });
});
