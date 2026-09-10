import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/server/morpho/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/server/morpho/config";

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { SavingsExperience } = await import("./savings-experience");

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const GAUNTLET = MORPHO_V1_CANDIDATE_ADDRESSES[1];
const STEAKHOUSE = MORPHO_V1_CANDIDATE_ADDRESSES[0];

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
    stateAsOf: "2026-09-08T12:00:00.000Z",
    blockNumber: "51026404",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: "2026-09-08T12:00:01.000Z",
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
    fetchedAt: "2026-09-07T20:30:00.000Z",
  },
  stale: false,
};

function session(address: typeof ADDRESS_A | typeof ADDRESS_B): VerifiedAccountSession {
  return {
    user: { subject: address === ADDRESS_A ? "subject-a" : "subject-b" },
    smartAccount: { address, chainId: 8453 },
    accountProvider: "cdp-embedded",
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
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function page() {
  return within(document.body);
}

afterEach(cleanup);

describe("Save simplify", () => {
  test("empty NUX keeps dollars as the hero and opens Deposit MoneyModal", async () => {
    const prepares: unknown[] = [];
    render(
      <SavingsExperience
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
    expect(page().getByText("Gauntlet · 4.10% APY")).toBeTruthy();
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

  test("funded hero sums vault card balances and opens Withdraw MoneyModal", async () => {
    render(
      <SavingsExperience
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
    expect(page().getByText("Earning ~4.10%")).toBeTruthy();
    expect(page().getByRole("radio", { name: /Gauntlet USDC Prime/ }).textContent).toContain("$820.00");
    expect(page().getByRole("radio", { name: /Steakhouse USDC/ }).textContent).toContain("$420.00");
    expect(page().queryByText("Nothing saved yet")).toBeNull();
    expect(page().queryByText("Get started")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Withdraw" }));
    expect(page().getByRole("dialog", { name: "Withdraw" })).toBeTruthy();
    expect(page().getByText("$820.00 available")).toBeTruthy();
  });

  test("positions loading stays Updating and does not claim unavailable", async () => {
    const pending = deferred<unknown>();
    render(
      <SavingsExperience
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={() => pending.promise}
      />,
    );

    expect(await page().findByText("Updating…")).toBeTruthy();
    expect(page().queryByText("Balances unavailable")).toBeNull();
    expect(page().queryByText("Nothing saved yet")).toBeNull();
  });

  test("unsigned Save hero stays empty NUX not unavailable", () => {
    render(<SavingsExperience initialData={initialData} session={null} />);

    expect(page().getByText("Nothing saved yet")).toBeTruthy();
    expect(page().getByText("$0.00")).toBeTruthy();
    expect(page().queryByText("Balances unavailable")).toBeNull();
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
          initialData={initialData}
          session={session(ADDRESS_A)}
          fetchPositions={async () => payload}
        />,
      );
      expect(await page().findByText("Balances unavailable")).toBeTruthy();
      expect(page().queryByText("Nothing saved yet")).toBeNull();
      cleanup();
    }
  });

  test("keeps a nullable indexed balance from looking like an empty NUX", async () => {
    render(
      <SavingsExperience
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: null })}
      />,
    );
    expect(await page().findByText("Balances unavailable")).toBeTruthy();
    expect(page().queryByText("Nothing saved yet")).toBeNull();
    expect(page().queryByText("Share base units")).toBeNull();
  });

  test("clears balances on account switch and ignores a late prior-wallet result", async () => {
    const pending = deferred<unknown>();
    const view = render(
      <SavingsExperience
        initialData={initialData}
        session={session(ADDRESS_A)}
        fetchPositions={async () => positions(ADDRESS_A, { [GAUNTLET]: "99000000" })}
      />,
    );
    expect((await page().findAllByText("$99.00")).length).toBeGreaterThan(0);

    view.rerender(
      <SavingsExperience
        initialData={initialData}
        session={session(ADDRESS_B)}
        fetchPositions={() => pending.promise}
      />,
    );
    await page().findByText("Updating…");
    expect(page().queryByText("$99.00")).toBeNull();

    view.rerender(
      <SavingsExperience initialData={initialData} session={null} fetchPositions={() => pending.promise} />,
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
