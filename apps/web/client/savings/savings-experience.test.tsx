import "@/client/account/dom-test-harness";

import { deferred } from "@/tests/helpers/async";
import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, jest, test } from "bun:test";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { SavingsExperience } = await import("./savings-experience");

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const CURATOR = "0x1234567890abcdef1234567890abcdef12345678";
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

function session(): VerifiedAccountSession {
  return {
    user: { subject: "subject-a" },
    smartAccount: { address: ADDRESS_A, chainId: 8453 },
    accountProvider: "cdp-embedded",
  };
}

function balancePositions(
  amounts: Partial<Record<string, string | null>> = {},
) {
  return MORPHO_V1_CANDIDATE_ADDRESSES.map((vaultAddress) => ({
    vaultAddress,
    position: amounts[vaultAddress] === null
      ? null
      : { assetsRaw: amounts[vaultAddress] ?? "0" },
  }));
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

afterEach(() => {
  jest.useRealTimers();
  cleanup();
  getHomeQueryClient().clear();
});

describe("Save simplify", () => {
  test("prepares a deposit with the selected vault and exact base-unit amount", async () => {
    const prepares: unknown[] = [];
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions()}
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
    fireEvent.click(page().getByRole("button", { name: "1" }));
    fireEvent.click(page().getByRole("button", { name: "0" }));
    fireEvent.click(page().getByRole("button", { name: "0" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    expect(prepares).toEqual([
      { kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "100000000" },
    ]);
  });

  test("condenses the selected vault curator address while preserving copy access", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={{
          ...initialData,
          candidates: [
            steakhouse,
            {
              ...gauntlet,
              curatorAddress: CURATOR as MorphoVaultCandidate["curatorAddress"],
            },
          ],
        }}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions()}
      />,
    );

    const curator = await page().findByRole("button", { name: "Copy 0x1234…345678" });
    expect(curator.textContent).toContain("0x1234…345678");
    expect(curator.textContent).not.toContain(CURATOR);
  });

  test("appends a stale snapshot age to the Save max label", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions()}
        availableUsdcBaseUnits="50000000"
        balanceAgeLabel="Updated 3 min ago"
        prepareMoneyAction={async () => preparedAction("savings-deposit")}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Get started" }));
    expect(page().getByText("Updated 3 min ago", { exact: false })).toBeTruthy();
  });

  test("sums every funded vault from the balances snapshot", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions({
          [GAUNTLET]: "820000000",
          [STEAKHOUSE]: "420000000",
        })}
        availableUsdcBaseUnits="50000000"
        prepareMoneyAction={async () => preparedAction("savings-withdraw")}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    const save = await page().findByRole("region", { name: "Save" });
    expect(save.textContent).toContain("$1,240.00");

    await act(async () => {
      fireEvent.click(page().getByRole("button", { name: "Withdraw" }));
    });
    expect(await page().findByRole("heading", { name: "Withdraw" })).toBeTruthy();
    expect(document.body.textContent).toContain("$820.00 available");
  });

  test("includes funded supported vaults outside the two visible selection rows", async () => {
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
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions({
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

  test("waits for balances and metadata in either request order", async () => {
    const view = render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="loading"
      />,
    );

    const metadataFirstSave = await page().findByRole("region", { name: "Save" });
    expect(metadataFirstSave.textContent).not.toContain("$0.00");
    view.rerender(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions()}
      />,
    );
    const vaultGroup = await page().findByRole("radiogroup", { name: "Vault" });
    expect(
      within(vaultGroup).getByRole("radio", { name: /Gauntlet USDC Prime/ }),
    ).toBeTruthy();

    cleanup();
    getHomeQueryClient().clear();

    const pendingMetadata = deferred<unknown>();
    render(
      <SavingsExperience
        now={testNow}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions()}
        fetchVaults={() => pendingMetadata.promise}
      />,
    );

    const balancesFirstSave = await page().findByRole("region", { name: "Save" });
    expect(balancesFirstSave.textContent).toContain("$0.00");
    expect(page().queryByRole("radio")).toBeNull();
    await act(async () => {
      pendingMetadata.resolve(initialData);
      await pendingMetadata.promise;
    });
    expect(await page().findByRole("radio", { name: /Gauntlet USDC Prime/ })).toBeTruthy();
  });

  test("shows an unavailable balance without inventing zero or an offer", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="error"
      />,
    );

    expect((await page().findByRole("status")).textContent).toBe("Balance unavailable");
    expect(page().getByRole("region", { name: "Save" }).textContent).not.toContain("$0.00");
    expect(page().queryByRole("button", { name: "Get started" })).toBeNull();
    expect(page().queryByRole("radio")).toBeNull();
  });

  test("keeps verified balances visible while the snapshot revalidates", async () => {
    const view = render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions({ [GAUNTLET]: "99000000" })}
      />,
    );
    expect((await page().findAllByText("$99.00")).length).toBeGreaterThan(0);

    view.rerender(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balanceRevalidating
        balancePositions={balancePositions({ [GAUNTLET]: "99000000" })}
      />,
    );

    expect(page().queryByText("Refreshing…")).toBeNull();
    expect(page().getAllByText("$99.00").length).toBeGreaterThan(0);
  });

  test("shows metadata failure beside a verified funded balance", async () => {
    render(
      <SavingsExperience
        now={testNow}
        session={session()}
        fetchVaults={async () => {
          throw new Error("offline");
        }}
        balanceStatus="ready"
        balancePositions={balancePositions({ [GAUNTLET]: "125000000" })}
      />,
    );

    const alert = await page().findByRole("alert");
    expect(alert.textContent).toBe("Vaults are temporarily unavailable.");
    expect(page().getByRole("region", { name: "Save" }).textContent).toContain("$125.00");
    expect(page().queryByRole("button", { name: "Deposit" })).toBeNull();
    expect(page().queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(page().queryByRole("radio")).toBeNull();
  });
});
