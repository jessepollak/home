import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { SavingsExperience } = await import("./savings-experience");

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const GAUNTLET = MORPHO_V1_CANDIDATE_ADDRESSES[1];
const STEAKHOUSE = MORPHO_V1_CANDIDATE_ADDRESSES[0];
const THIRD_VAULT = MORPHO_V1_CANDIDATE_ADDRESSES[2];
const TEST_NOW = Date.parse("2026-09-10T12:04:00.000Z");
const testNow = () => TEST_NOW;

function candidate(
  vaultAddress: string,
  name: string,
  netApy: number,
): MorphoVaultCandidate {
  return {
    version: "v1",
    vaultAddress: vaultAddress as MorphoVaultCandidate["vaultAddress"],
    name,
    symbol: "USDC vault",
    listed: true,
    chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    curatorAddress: null,
    grossApy: netApy + 0.005,
    netApy,
    feeRate: 0.1,
    totalAssetsRaw: "100000000",
    liquidityRaw: "50000000",
    stateAsOf: "2026-09-10T12:00:00.000Z",
    blockNumber: "51026404",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: "2026-09-10T12:00:01.000Z",
    },
  };
}

const gauntlet = candidate(GAUNTLET, "Gauntlet USDC Prime", 0.041);
const steakhouse = candidate(STEAKHOUSE, "Steakhouse USDC", 0.0385);

const initialData: MorphoVaultsResult = {
  version: "v1",
  chainId: 8453,
  asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [steakhouse, gauntlet],
  source: {
    provider: "Morpho GraphQL",
    endpoint: "https://api.morpho.org/graphql",
    query: "vaults",
    fetchedAt: "2026-09-10T12:00:00.000Z",
  },
  stale: false,
};

function session(
  address: typeof ADDRESS_A | typeof ADDRESS_B,
  accountProvider: VerifiedAccountSession["accountProvider"] = "cdp-embedded",
): VerifiedAccountSession {
  return {
    user: { subject: address === ADDRESS_A ? "subject-a" : "subject-b" },
    smartAccount: { address, chainId: 8453 },
    accountProvider,
  };
}

function position(
  address: typeof ADDRESS_A | typeof ADDRESS_B,
  vaultAddress: string,
  assetsRaw: string | null,
) {
  return {
    version: "v1" as const,
    accountAddress: address,
    vaultAddress,
    assetsRaw,
    sharesRaw: "1200000",
    indexedAt: "2026-09-07T20:30:01.000Z",
    source: {
      provider: "Morpho GraphQL" as const,
      endpoint: "https://api.morpho.org/graphql" as const,
      query: "vaultPosition" as const,
      fetchedAt: "2026-09-07T20:30:02.000Z",
    },
    withdrawableRaw: null,
    withdrawableNote: "No maxWithdraw query was made.",
  };
}

function positions(
  address: typeof ADDRESS_A | typeof ADDRESS_B,
  amounts: Partial<Record<string, string | null>> = {},
) {
  return {
    accountAddress: address,
    fetchedAt: "2026-09-07T20:30:02.000Z",
    vaults: MORPHO_V1_CANDIDATE_ADDRESSES.map((vaultAddress) => ({
      vaultAddress,
      position: vaultAddress in amounts
        ? position(address, vaultAddress, amounts[vaultAddress] ?? null)
        : null,
    })),
  };
}

function preparedAction(kind: "save-deposit" | "save-withdraw"): PreparedMoneyAction {
  return {
    id: "action-1",
    kind,
    title: kind === "save-deposit" ? "Deposit" : "Withdraw",
    reviewHash: "hash",
    createdAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2099-09-09T00:00:00.000Z",
    calls: [],
    amounts: [],
    warnings: [],
    owner: {
      subject: "subject-a",
      address: ADDRESS_A,
      chainId: 8453,
      accountProvider: "cdp-embedded",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function page() {
  return within(document.body);
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("Save simplify", () => {
  test("empty NUX keeps dollars as the hero and opens Deposit MoneyModal", async () => {
    const prepares: unknown[] = [];
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A)}
        availableUsdcBaseUnits="128400000"
        prepareMoneyAction={async (_endpoint, input) => {
          prepares.push(input);
          return preparedAction("save-deposit");
        }}
        checkMoneyAction={async () => ({ id: "action-1", status: "prepared" })}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    await page().findByText("Nothing saved yet");
    expect(page().getByText("$0.00")).toBeTruthy();
    expect(page().getByText("Available vault · Gauntlet · 4.10% APY")).toBeTruthy();
    expect(page().getByRole("radio", { name: /Gauntlet USDC Prime/ }).textContent).toContain("4.10%");
    expect(page().getByRole("radio", { name: /Steakhouse USDC/ }).textContent).toContain("3.85%");
    expect(page().queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(page().getByText("Details")).toBeTruthy();
    expect(page().queryByText("Rate comparison")).toBeNull();
    expect(page().queryByText("Vault candidates")).toBeNull();
    expect(page().queryByText("Prepare an action")).toBeNull();
    expect(page().queryByText(/Morpho V1/)).toBeNull();
    expect(page().queryByText(/Borrow/)).toBeNull();
    expect(document.body.textContent).not.toContain("As of");
    expect(document.body.textContent).not.toContain("Share base units");

    fireEvent.click(page().getByRole("button", { name: "Get started" }));
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
    expect(page().getByText("$128.40 available")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "1" }));
    fireEvent.click(page().getByRole("button", { name: "0" }));
    fireEvent.click(page().getByRole("button", { name: "0" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(page().getByText("Deposit to Save")).toBeTruthy();
    expect(page().getByRole("dialog").textContent).toContain("Gauntlet USDC Prime");
    expect(prepares).toEqual([
      { kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "100000000" },
    ]);
  });

  test("refreshes positions and APY metadata after a confirmed savings action", async () => {
    let positionReads = 0;
    let metadataReads = 0;
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => {
          positionReads += 1;
          return positions(ADDRESS_A);
        }}
        fetchVaults={async () => {
          metadataReads += 1;
          return initialData;
        }}
        availableUsdcBaseUnits="50000000"
        prepareMoneyAction={async () => preparedAction("save-deposit")}
        checkMoneyAction={async () => ({ id: "action-1", status: "prepared" })}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    await page().findByText("Nothing saved yet");
    fireEvent.click(page().getByRole("button", { name: "Get started" }));
    fireEvent.click(page().getByRole("button", { name: "1" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));

    await waitFor(() => {
      expect(positionReads).toBe(2);
      expect(metadataReads).toBe(1);
    });
  });

  test("funded hero sums vault card balances and opens Withdraw MoneyModal", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, {
          [GAUNTLET]: "820000000",
          [STEAKHOUSE]: "420000000",
        })}
        availableUsdcBaseUnits="50000000"
        prepareMoneyAction={async () => preparedAction("save-withdraw")}
        checkMoneyAction={async () => ({ id: "action-1", status: "prepared" })}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    expect(await page().findByText("$1,240.00")).toBeTruthy();
    expect(page().getByText("Earning ~4.02%")).toBeTruthy();
    fireEvent.click(page().getByRole("radio", { name: /Steakhouse USDC/ }));
    expect(page().getByText("Earning ~4.02%")).toBeTruthy();
    fireEvent.click(page().getByRole("radio", { name: /Gauntlet USDC Prime/ }));
    expect(page().getByRole("radio", { name: /Gauntlet USDC Prime/ }).textContent).toContain("$820.00");
    expect(page().getByRole("radio", { name: /Steakhouse USDC/ }).textContent).toContain("$420.00");
    expect(page().queryByText("Nothing saved yet")).toBeNull();
    expect(page().queryByText("Get started")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Withdraw" }));
    expect(page().getByRole("dialog", { name: "Withdraw" })).toBeTruthy();
    expect(page().getByText("$820.00 available")).toBeTruthy();
  });

  test("includes funded supported vaults that are outside the two visible selection rows", async () => {
    const allVaultData: MorphoVaultsResult = {
      ...initialData,
      candidates: [
        candidate(STEAKHOUSE, "Steakhouse USDC", 0.04),
        candidate(GAUNTLET, "Gauntlet USDC Prime", 0.06),
        candidate(THIRD_VAULT, "Third USDC", 0.08),
      ],
    };
    render(
      <SavingsExperience
        now={testNow}
        initialData={allVaultData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, {
          [STEAKHOUSE]: "100000000",
          [GAUNTLET]: "300000000",
          [THIRD_VAULT]: "600000000",
        })}
      />,
    );

    expect(await page().findByText("$1,000.00")).toBeTruthy();
    expect(page().getByText("Earning ~7.00%")).toBeTruthy();
    expect(page().queryByRole("radio", { name: /Third USDC/ })).toBeNull();
  });

  test("positions loading shimmers without flashing zero, empty, offer, or 0%", async () => {
    const pending = deferred<unknown>();
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={() => pending.promise}
      />,
    );

    expect(await page().findByText("Updating…")).toBeTruthy();
    expect(document.querySelector("[data-shimmer='savings-hero']")).toBeTruthy();
    expect(page().queryByText("Balance unavailable")).toBeNull();
    expect(page().queryByText("Nothing saved yet")).toBeNull();
    expect(page().queryByText("$0.00")).toBeNull();
    expect(page().queryByText(/Available vault/)).toBeNull();
    expect(page().queryByText("0%")).toBeNull();
    expect(page().queryByRole("button", { name: "Get started" })).toBeNull();
  });

  test("unsigned Save hero stays empty NUX not unavailable", () => {
    render(<SavingsExperience now={testNow} initialData={initialData} session={null} />);

    expect(page().getByText("Nothing saved yet")).toBeTruthy();
    expect(page().getByText("$0.00")).toBeTruthy();
    expect(page().queryByText("Balance unavailable")).toBeNull();
    expect(page().queryByText("Updating…")).toBeNull();
  });

  test("rejects empty, subset, and duplicate vault coverage instead of claiming nothing is saved", async () => {
    const complete = positions(ADDRESS_A);
    const malformed = [
      { ...complete, vaults: [] },
      { ...complete, vaults: complete.vaults.slice(0, 2) },
      { ...complete, vaults: [complete.vaults[0], complete.vaults[0], complete.vaults[1]] },
    ];
    for (const payload of malformed) {
      render(
        <SavingsExperience
        now={testNow}
          initialData={initialData}
          session={session(ADDRESS_A)}
          fetchPositions={async () => payload}
        />,
      );
      expect(await page().findByText("Balance unavailable")).toBeTruthy();
      expect(page().queryByText("Nothing saved yet")).toBeNull();
      cleanup();
    }
  });

  test("keeps a nullable indexed balance from looking like an empty NUX", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: null })}
      />,
    );
    expect(await page().findByText("Balance unavailable")).toBeTruthy();
    expect(page().queryByText("Nothing saved yet")).toBeNull();
    expect(page().queryByText("Share base units")).toBeNull();
  });

  test("waits for positions and metadata in either request order", async () => {
    const metadataFirstPositions = deferred<unknown>();
    globalThis.fetch = (async () => new Response(JSON.stringify(initialData), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    render(
      <SavingsExperience
        now={testNow}
        session={session(ADDRESS_A)}
        fetchPositions={() => metadataFirstPositions.promise}
      />,
    );
    expect(await page().findByText("Updating…")).toBeTruthy();
    expect(page().queryByText("$0.00")).toBeNull();
    await act(async () => {
      metadataFirstPositions.resolve(positions(ADDRESS_A));
      await metadataFirstPositions.promise;
    });
    expect(await page().findByText("Nothing saved yet")).toBeTruthy();
    cleanup();

    const pendingMetadata = deferred<Response>();
    globalThis.fetch = (() => pendingMetadata.promise) as unknown as typeof fetch;
    render(
      <SavingsExperience
        now={testNow}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A)}
      />,
    );
    expect(await page().findByText("$0.00")).toBeTruthy();
    expect(page().getAllByText("Loading vaults…").length).toBeGreaterThan(0);
    expect(page().queryByText(/Available vault/)).toBeNull();
    await act(async () => {
      pendingMetadata.resolve(new Response(JSON.stringify(initialData), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      await pendingMetadata.promise;
    });
    expect(await page().findByText("Nothing saved yet")).toBeTruthy();
  });

  test("shows a verified funded balance while APY metadata is still pending", async () => {
    const pendingMetadata = deferred<unknown>();
    render(
      <SavingsExperience
        now={testNow}
        session={session(ADDRESS_A)}
        fetchVaults={() => pendingMetadata.promise}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "125000000" })}
      />,
    );

    expect(await page().findByText("$125.00")).toBeTruthy();
    expect(page().getByText("Loading APY…")).toBeTruthy();
    expect(page().queryByText(/Earning ~/)).toBeNull();
    expect(page().queryByText(/Available vault/)).toBeNull();
    expect(page().queryByText("$0.00")).toBeNull();
  });

  test("expires a mounted funded APY from source timestamps", async () => {
    jest.useFakeTimers();
    let currentNow = TEST_NOW;
    const controlledNow = () => currentNow;
    const freshnessHeadroomMs = 1_000;
    const almostExpired = new Date(
      currentNow - 5 * 60_000 + freshnessHeadroomMs,
    ).toISOString();
    const expiringData: MorphoVaultsResult = {
      ...initialData,
      candidates: initialData.candidates.map((entry) => ({
        ...entry,
        stateAsOf: almostExpired,
        source: { ...entry.source, fetchedAt: almostExpired },
      })),
      source: { ...initialData.source, fetchedAt: almostExpired },
    };
    render(
      <SavingsExperience
        now={controlledNow}
        initialData={expiringData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "100000000" })}
      />,
    );

    expect(await page().findByText("Earning ~4.10%")).toBeTruthy();

    currentNow += freshnessHeadroomMs + 1;
    await act(async () => {
      jest.advanceTimersByTime(freshnessHeadroomMs + 1);
    });

    expect(page().getByText("APY data stale")).toBeTruthy();
    expect(page().queryByText(/Earning ~/)).toBeNull();
  });

  test("applies the same non-negative rate policy to hero, rows, and offers", async () => {
    const negativeRateData: MorphoVaultsResult = {
      ...initialData,
      candidates: initialData.candidates.map((entry) =>
        entry.vaultAddress === GAUNTLET ? { ...entry, netApy: -0.01 } : entry
      ),
    };
    const fundedView = render(
      <SavingsExperience
        now={testNow}
        initialData={negativeRateData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "100000000" })}
      />,
    );
    expect((await page().findAllByText("APY unavailable")).length).toBeGreaterThan(0);
    expect(page().getByRole("radio", { name: /Gauntlet USDC Prime/ }).textContent).toContain(
      "APY unavailable",
    );
    expect(document.body.textContent).not.toContain("-1.00%");
    fundedView.unmount();

    render(<SavingsExperience now={testNow} initialData={negativeRateData} session={null} />);
    expect(page().getByText("Available vault · Gauntlet · APY unavailable")).toBeTruthy();
    expect(page().getByRole("radio", { name: /Gauntlet USDC Prime/ }).textContent).toContain(
      "APY unavailable",
    );
  });

  test("shows truthful APY states for missing and stale funded rates", async () => {
    const missingRateData: MorphoVaultsResult = {
      ...initialData,
      candidates: initialData.candidates.map((entry) =>
        entry.vaultAddress === STEAKHOUSE ? { ...entry, netApy: null } : entry
      ),
    };
    const missing = render(
      <SavingsExperience
        now={testNow}
        initialData={missingRateData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, {
          [GAUNTLET]: "100000000",
          [STEAKHOUSE]: "300000000",
        })}
      />,
    );
    expect(await page().findByText("$400.00")).toBeTruthy();
    expect(page().getByText("APY partially unavailable")).toBeTruthy();
    expect(page().queryByText(/Earning ~/)).toBeNull();
    missing.unmount();

    render(
      <SavingsExperience
        now={testNow}
        initialData={{ ...initialData, stale: true }}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "100000000" })}
      />,
    );
    expect((await page().findAllByText("$100.00")).length).toBeGreaterThan(0);
    expect(page().getByText("APY data stale")).toBeTruthy();
    expect(page().getByRole("radio", { name: /Gauntlet USDC Prime/ }).textContent).toContain(
      "APY stale",
    );
  });

  test("shows an error without inventing a zero balance or offer", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => {
          throw new Error("offline");
        }}
      />,
    );

    expect(await page().findByText("Balance unavailable")).toBeTruthy();
    expect(page().queryByText("$0.00")).toBeNull();
    expect(page().queryByText("Nothing saved yet")).toBeNull();
    expect(page().queryByRole("button", { name: "Get started" })).toBeNull();
  });

  test("retains a verified same-owner value during refresh and reports refresh failure", async () => {
    const pending = deferred<unknown>();
    const view = render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "99000000" })}
      />,
    );
    expect((await page().findAllByText("$99.00")).length).toBeGreaterThan(0);

    view.rerender(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={() => pending.promise}
      />,
    );
    expect(await page().findByText("Refreshing…")).toBeTruthy();
    expect(page().getAllByText("$99.00").length).toBeGreaterThan(0);

    await act(async () => {
      pending.reject(new Error("offline"));
      try {
        await pending.promise;
      } catch {
        // The component converts this request failure into retained stale UI.
      }
    });
    expect(await page().findByText("Refresh unavailable")).toBeTruthy();
    expect(page().getAllByText("$99.00").length).toBeGreaterThan(0);
  });

  test("retains a verified same-owner value after a malformed successful refresh", async () => {
    const pending = deferred<unknown>();
    const view = render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "99000000" })}
      />,
    );
    expect((await page().findAllByText("$99.00")).length).toBeGreaterThan(0);

    view.rerender(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={() => pending.promise}
      />,
    );
    await page().findByText("Refreshing…");
    const malformed = positions(ADDRESS_A, { [GAUNTLET]: "100000000" });
    malformed.vaults[1] = {
      ...malformed.vaults[1],
      position: position(ADDRESS_A, malformed.vaults[1]!.vaultAddress, "not-base-units"),
    };
    await act(async () => {
      pending.resolve(malformed);
      await pending.promise;
    });

    expect(await page().findByText("Refresh unavailable")).toBeTruthy();
    expect(page().getAllByText("$99.00").length).toBeGreaterThan(0);
    expect(page().queryByText("$100.00")).toBeNull();
    expect(page().getByText("Earning ~4.10%")).toBeTruthy();
  });

  test("retains balance but expires APY when a malformed refresh arrives after the rate budget", async () => {
    let currentNow = TEST_NOW;
    const controlledNow = () => currentNow;
    const pending = deferred<unknown>();
    const view = render(
      <SavingsExperience
        now={controlledNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "99000000" })}
      />,
    );
    expect(await page().findByText("Earning ~4.10%")).toBeTruthy();

    currentNow = Date.parse("2026-09-10T12:06:00.000Z");
    view.rerender(
      <SavingsExperience
        now={controlledNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={() => pending.promise}
      />,
    );
    await page().findByText("Refreshing…");
    const malformed = positions(ADDRESS_A);
    malformed.vaults = malformed.vaults.slice(0, 2);
    await act(async () => {
      pending.resolve(malformed);
      await pending.promise;
    });

    expect(await page().findByText("Refresh unavailable")).toBeTruthy();
    expect(page().getAllByText("$99.00").length).toBeGreaterThan(0);
    expect(page().getByText("APY data stale")).toBeTruthy();
    expect(page().queryByText(/Earning ~/)).toBeNull();
  });

  test("clears balances on provider switch before a new request resolves", async () => {
    const pending = deferred<unknown>();
    const view = render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "99000000" })}
      />,
    );
    expect((await page().findAllByText("$99.00")).length).toBeGreaterThan(0);

    view.rerender(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A, "base-account")}
        fetchPositions={() => pending.promise}
      />,
    );
    expect(await page().findByText("Updating…")).toBeTruthy();
    expect(page().queryByText("$99.00")).toBeNull();
  });

  test("fences a late A response across an A to B to A sequence", async () => {
    const firstA = deferred<unknown>();
    const requestB = deferred<unknown>();
    const latestA = deferred<unknown>();
    const view = render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={() => firstA.promise}
      />,
    );
    await page().findByText("Updating…");

    view.rerender(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_B)}
        fetchPositions={() => requestB.promise}
      />,
    );
    await page().findByText("Updating…");

    view.rerender(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={() => latestA.promise}
      />,
    );
    await act(async () => {
      latestA.resolve(positions(ADDRESS_A, { [GAUNTLET]: "3000000" }));
      await latestA.promise;
    });
    expect((await page().findAllByText("$3.00")).length).toBeGreaterThan(0);

    await act(async () => {
      firstA.resolve(positions(ADDRESS_A, { [GAUNTLET]: "99000000" }));
      await firstA.promise;
    });
    expect(page().queryByText("$99.00")).toBeNull();
    expect(page().getAllByText("$3.00").length).toBeGreaterThan(0);
  });

  test("clears balances on account switch and ignores a late prior-wallet result", async () => {
    const pending = deferred<unknown>();
    const view = render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "99000000" })}
      />,
    );
    expect((await page().findAllByText("$99.00")).length).toBeGreaterThan(0);

    view.rerender(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_B)}
        fetchPositions={() => pending.promise}
      />,
    );
    await page().findByText("Updating…");
    expect(page().queryByText("$99.00")).toBeNull();

    view.rerender(
      <SavingsExperience now={testNow} initialData={initialData} session={null} fetchPositions={() => pending.promise} />,
    );
    await act(async () => {
      pending.resolve(positions(ADDRESS_B, { [GAUNTLET]: "2500000" }));
      await pending.promise;
    });
    expect(page().queryByText("$2.50")).toBeNull();
    expect(page().getByText("Nothing saved yet")).toBeTruthy();
    expect(page().getByText("$0.00")).toBeTruthy();
  });
});
