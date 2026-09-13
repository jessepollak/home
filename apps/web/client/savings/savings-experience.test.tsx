import "@/client/account/dom-test-harness";

import { deferred } from "@/tests/helpers/async";
import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, jest, test } from "bun:test";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
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

function preparedAction(kind: "savings-deposit" | "savings-withdraw"): PreparedMoneyAction {
  return {
    id: "action-1",
    kind,
    title: kind === "savings-deposit" ? "Deposit" : "Withdraw",
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

const originalFetch = globalThis.fetch;

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
  cleanup();
  getHomeQueryClient().clear();
});

describe("Save simplify", () => {
  test("exposes vault selection as named radio controls with checked state", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A)}
      />,
    );

    const gauntletRadio = await page().findByRole("radio", { name: /Gauntlet USDC Prime/ });
    const steakhouseRadio = page().getByRole("radio", { name: /Steakhouse USDC/ });
    expect(gauntletRadio.getAttribute("aria-checked")).toBe("true");
    expect(steakhouseRadio.getAttribute("aria-checked")).toBe("false");
    expect(gauntletRadio.getAttribute("name")).toBe("savings-vault");
    fireEvent.click(steakhouseRadio);
    expect(steakhouseRadio.getAttribute("aria-checked")).toBe("true");
    expect(gauntletRadio.getAttribute("aria-checked")).toBe("false");
  });

  test("prepares a deposit with the selected vault and exact base-unit amount", async () => {
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
          return preparedAction("savings-deposit");
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    await page().findByRole("button", { name: "Get started" });
    fireEvent.click(page().getByRole("button", { name: "Get started" }));
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "1" }));
    fireEvent.click(page().getByRole("button", { name: "0" }));
    fireEvent.click(page().getByRole("button", { name: "0" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    expect(prepares).toEqual([
      { kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "100000000" },
    ]);
  });

  test("leaves post-action refresh to the shared query invalidation path", async () => {
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
        prepareMoneyAction={async () => preparedAction("savings-deposit")}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    await page().findByText("Nothing saved yet");
    fireEvent.click(page().getByRole("button", { name: "Get started" }));
    fireEvent.click(page().getByRole("button", { name: "1" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(positionReads).toBe(1);
    expect(metadataReads).toBe(0);
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
        prepareMoneyAction={async () => preparedAction("savings-withdraw")}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    expect(await page().findByText("$1,240.00")).toBeTruthy();
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
    getHomeQueryClient().clear();

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
    expect(document.querySelectorAll("[data-shimmer='vault-row']").length).toBe(2);
    expect(page().queryByText(/Available vault/)).toBeNull();
    expect(page().queryByText("Details")).toBeNull();
    await act(async () => {
      pendingMetadata.resolve(new Response(JSON.stringify(initialData), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      await pendingMetadata.promise;
    });
    expect(await page().findByText("Nothing saved yet")).toBeTruthy();
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
    expect(page().queryByRole("radio")).toBeNull();
    expect(page().queryByText("Details")).toBeNull();
  });

  test("exposes no actions or vault controls when metadata fails after positions resolve", async () => {
    render(
      <SavingsExperience
        now={testNow}
        session={session(ADDRESS_A)}
        fetchVaults={async () => {
          throw new Error("offline");
        }}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "125000000" })}
      />,
    );

    expect(await page().findByText("Vaults are temporarily unavailable.")).toBeTruthy();
    expect(await page().findByText("$125.00")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Deposit" })).toBeNull();
    expect(page().queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(page().queryByRole("radio")).toBeNull();
    expect(page().queryByText("Details")).toBeNull();
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
    void getHomeQueryClient().invalidateQueries({
      queryKey: [activityOwnerKey(session(ADDRESS_A)), "savings-positions"],
    });
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
    void getHomeQueryClient().invalidateQueries({
      queryKey: [activityOwnerKey(session(ADDRESS_A)), "savings-positions"],
    });
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
