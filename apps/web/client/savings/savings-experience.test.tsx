import "@/client/account/dom-test-harness";

import { deferred } from "@/tests/helpers/async";
import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, jest, test } from "bun:test";
import { getHomeQueryClient, publicQueryKey } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
let reducedMotion = false;
window.matchMedia = ((query: string) => ({
  get matches() { return query === reducedMotionQuery && reducedMotion; },
  media: query,
  onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent: () => true,
})) as typeof window.matchMedia;
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { SavingsExperience } = await import("./savings-experience");
const { PresentationRegionProvider } = await import("@/client/invest/presentation-quote");

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const CURATOR = "0x1234567890abcdef1234567890abcdef12345678";
const GAUNTLET = MORPHO_V1_CANDIDATE_ADDRESSES[0];
const STEAKHOUSE = MORPHO_V1_CANDIDATE_ADDRESSES[2];
const SPARK = MORPHO_V1_CANDIDATE_ADDRESSES[1];
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

function preparedAction(
  kind: "savings-deposit" | "savings-withdraw",
  amountBaseUnits = "100000000",
): PreparedMoneyAction {
  const deposit = kind === "savings-deposit";
  const shares = `${amountBaseUnits}000000000000`;
  return {
    id: "action-1",
    kind,
    title: deposit ? "Deposit" : "Withdraw",
    createdAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2099-09-09T00:00:00.000Z",
    calls: [],
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits, direction: deposit ? "spend" : "receive" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: shares, direction: deposit ? "receive" : "spend", estimated: true },
    ],
    warnings: [],
    metadata: {
      product: "savings",
      operation: deposit ? "deposit" : "withdraw",
      vaultAddress: GAUNTLET,
      vaultName: gauntlet.name,
      network: { name: "Base", chainId: 8453 },
      feeWad: "100000000000000000",
      limitBaseUnits: "9999999999999999",
      previewSharesBaseUnits: shares,
      shareDecimals: 18,
      exchangeConstraint: deposit ? "deposit-minimum-shares-or-revert" : "withdraw-exact-assets-or-revert",
      ...(deposit ? { minimumSharesBaseUnits: shares } : {}),
      discoveryRate: { status: "current", netApy: "0.041", fetchedAt: "2026-09-10T12:00:01.000Z", stateAsOf: "2026-09-10T12:00:00.000Z" },
      source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789041600" },
    },
    owner: {
      subject: "subject-a",
      address: ADDRESS_A,
      chainId: 8453,
      accountProvider: "cdp-embedded",
    },
  };
}

function growthAuthority() {
  return {
    accountIdentity: `subject-a:${ADDRESS_A}`,
    assetIdentity: `${BASE_USDC_ADDRESS.toLowerCase()}:8453:6`,
    blockNumber: "51026404",
    blockHash: "0xabc",
    blockTimestamp: String(Math.floor((TEST_NOW - 60_000) / 1000)),
    snapshotStale: false,
    registryCoverageComplete: true,
  };
}

afterEach(() => {
  reducedMotion = false;
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
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value: "100" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    expect(prepares).toEqual([
      { kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "100000000" },
    ]);
  });

  test("defers a stale wallet balance cap to deposit preparation", async () => {
    const prepares: unknown[] = [];
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions()}
        availableUsdcBaseUnits="50000000"
        balanceStale
        prepareMoneyAction={async (_endpoint, input) => {
          prepares.push(input);
          return preparedAction("savings-deposit");
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Get started" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value: "100" } });
    const continueButton = page().getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);
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

  test("does not append snapshot age to the Save max label", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions()}
        availableUsdcBaseUnits="50000000"
        prepareMoneyAction={async () => preparedAction("savings-deposit")}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Get started" }));
    await waitFor(() => expect(document.body.textContent).toContain("$50.00 available"));
    expect(document.body.textContent).not.toContain("Updated");
  });

  test("floors the deposit available label while Max uses exact USDC base units", async () => {
    const prepares: unknown[] = [];
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions()}
        availableUsdcBaseUnits="7899998"
        prepareMoneyAction={async (_endpoint, input) => {
          prepares.push(input);
          return preparedAction("savings-deposit", "7899998");
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Get started" }));
    expect(await page().findByText("$7.89 available")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    expect(prepares).toEqual([
      { kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "7899998" },
    ]);
  });

  test("floors the withdraw available label while Max uses exact vault base units", async () => {
    const prepares: unknown[] = [];
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions({ [GAUNTLET]: "7899998" })}
        prepareMoneyAction={async (_endpoint, input) => {
          prepares.push(input);
          return preparedAction("savings-withdraw", "7899998");
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: "Withdraw" }));
    expect(await page().findByText("$7.89 available")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    expect(prepares).toEqual([
      { kind: "withdraw", vaultAddress: GAUNTLET, amountBaseUnits: "7899998" },
    ]);
  });

  test("keeps the available balance exact in comma-decimal regions", async () => {
    render(
      <PresentationRegionProvider regionId="DE">
        <SavingsExperience
          now={testNow}
          initialData={initialData}
          session={session()}
          balanceStatus="ready"
          balancePositions={balancePositions()}
          availableUsdcBaseUnits="1234567890"
          prepareMoneyAction={async () => preparedAction("savings-deposit", "1234567890")}
          executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
        />
      </PresentationRegionProvider>,
    );

    fireEvent.click(await page().findByRole("button", { name: "Get started" }));
    expect(await page().findByText("1,234.56 USDC available")).toBeTruthy();
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

  test("shows all configured vault identities while aggregating every funded position", async () => {
    const allVaultData: MorphoVaultsResult = {
      ...initialData,
      candidates: [
        candidate(STEAKHOUSE, "Steakhouse USDC", 0.04),
        candidate(GAUNTLET, "Gauntlet USDC Prime", 0.06),
        candidate(SPARK, "Spark USDC Vault", 0.08),
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
          [SPARK]: "600000000",
        })}
      />,
    );

    expect(await page().findByText("$1,000.00")).toBeTruthy();
    expect(page().getByText("Earning ~7.00%")).toBeTruthy();
    expect(page().getByRole("radio", { name: /Gauntlet USDC Prime/ })).toBeTruthy();
    expect(page().getByRole("radio", { name: /Spark USDC Vault/ })).toBeTruthy();
    expect(page().getByRole("radio", { name: /Steakhouse USDC/ })).toBeTruthy();
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

    expect((await page().findByRole("status")).textContent).toBe("Saved balance unavailable");
    expect(page().getByRole("region", { name: "Save" }).textContent).not.toContain("$0.00");
    expect(page().queryByRole("button", { name: "Get started" })).toBeNull();
    expect(page().queryByRole("radio")).toBeNull();
  });

  test("keeps a stale verified snapshot visible with an explicit retry and no freshness age", async () => {
    let retries = 0;
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions({ [GAUNTLET]: "99000000" })}
        balanceStale
        onRetryBalances={() => { retries += 1; }}
      />,
    );

    expect((await page().findAllByText("$99.00")).length).toBeGreaterThan(0);
    const staleNotice = page().getByRole("status");
    expect(staleNotice.textContent).toContain("Saved balance stale.");
    expect(staleNotice.textContent).not.toContain("updated");
    expect(staleNotice.textContent).not.toContain("ago");
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(retries).toBe(1);
  });

  test("labels a partial position read without summing it into an invented total", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions({ [GAUNTLET]: "99000000", [STEAKHOUSE]: null })}
      />,
    );

    expect((await page().findByRole("status")).textContent).toBe(
      "Saved balance partially unavailable",
    );
    expect(page().getByRole("region", { name: "Save" }).textContent).not.toContain("$0.00");
    expect(page().getAllByText("$99.00").length).toBeGreaterThan(0);
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

  test("advances only the hero while withdrawal Max and prepared base units stay authoritative", async () => {
    const authoritative = "1000000000000000";
    const prepares: unknown[] = [];
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions({ [GAUNTLET]: authoritative })}
        growthAuthority={growthAuthority()}
        prepareMoneyAction={async (_endpoint, input) => {
          prepares.push(input);
          return preparedAction("savings-withdraw", authoritative);
        }}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    const authoritativeLabel = "$1,000,000,000.00";
    expect(await page().findByRole("img", { name: authoritativeLabel })).toBeTruthy();
    void act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(page().queryByRole("img", { name: authoritativeLabel })).not.toBeNull();
    const save = page().getByRole("region", { name: "Save" });
    // The hero is the first ticker in document order; the vault row keeps the raw position.
    const hero = save.querySelector("[data-slot='money-ticker']");
    expect(hero?.getAttribute("aria-label")).not.toBe(authoritativeLabel);
    expect(hero?.getAttribute("data-animated")).toBe("true");
    expect(hero?.getAttribute("role")).toBe("img");
    expect(hero?.hasAttribute("aria-live")).toBe(false);
    expect(hero?.closest("p")?.hasAttribute("aria-live")).toBe(false);

    fireEvent.click(page().getByRole("button", { name: "Withdraw" }));
    expect(await page().findByText(`${authoritativeLabel} available`)).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    expect(prepares).toEqual([
      { kind: "withdraw", vaultAddress: GAUNTLET, amountBaseUnits: authoritative },
    ]);
  });

  test("holds the authoritative hero value and disables ticker animation under reduced motion", async () => {
    reducedMotion = true;
    const authoritative = "1000000000000000";
    const authoritativeLabel = "$1,000,000,000.00";
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions({ [GAUNTLET]: authoritative })}
        growthAuthority={growthAuthority()}
      />,
    );

    await page().findAllByRole("img", { name: authoritativeLabel });
    const hero = () => page()
      .getByRole("region", { name: "Save" })
      .querySelector("[data-slot='money-ticker']");
    expect(hero()?.getAttribute("aria-label")).toBe(authoritativeLabel);
    expect(hero()?.getAttribute("data-animated")).toBe("false");
    void act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(hero()?.getAttribute("aria-label")).toBe(authoritativeLabel);
  });

  test("keeps expired and server-stale APY visible without an APY warning", async () => {
    let clock = TEST_NOW;
    const positions = balancePositions({ [GAUNTLET]: "100000000", [STEAKHOUSE]: "300000000" });
    const data = {
      ...initialData,
      candidates: [candidate(GAUNTLET, "Gauntlet USDC Prime", 0.04), candidate(STEAKHOUSE, "Steakhouse USDC", 0.06)],
      stale: false,
    };
    const view = render(
      <SavingsExperience initialData={data} now={() => clock} session={session()}
        balanceStatus="ready" balancePositions={positions} />,
    );
    expect(await page().findByText("Earning ~5.50%")).toBeTruthy();
    expect(page().getByRole("region", { name: "Save" }).textContent).not.toMatch(/APY.*stale|stale.*APY/i);
    clock += 7 * 60_000;
    view.rerender(<SavingsExperience initialData={data} now={() => clock} session={session()}
      balanceStatus="ready" balancePositions={[...positions]} />);
    expect(await page().findByText("Earning ~5.50%")).toBeTruthy();
    expect(page().getByRole("region", { name: "Save" }).textContent).not.toMatch(/stale/i);
    view.rerender(<SavingsExperience initialData={data} now={() => clock} session={session()}
      balanceStatus="ready" balancePositions={balancePositions({ [GAUNTLET]: "100000000" })} />);
    expect(await page().findByText("Earning ~4.00%")).toBeTruthy();
    expect(page().queryByText("Earning ~5.50%")).toBeNull();
    cleanup();
    getHomeQueryClient().clear();
    render(<SavingsExperience initialData={{ ...data, stale: true }} now={() => clock}
      session={session()} balanceStatus="ready" balancePositions={positions} />);
    expect(await page().findByText("Earning ~5.50%")).toBeTruthy();
    expect(page().getByRole("region", { name: "Save" }).textContent).not.toMatch(/stale/i);
  });

  test("omits unknown APY on a cold fetch failure, null rates, and shows real zero", async () => {
    render(<SavingsExperience now={testNow} session={session()}
      fetchVaults={async () => { throw new Error("offline"); }}
      balanceStatus="ready" balancePositions={balancePositions({ [GAUNTLET]: "100000000" })} />);
    expect(await page().findByText("Vaults are temporarily unavailable.")).toBeTruthy();
    expect(page().getByRole("region", { name: "Save" }).textContent).not.toMatch(/APY|Earning/i);
    cleanup();
    getHomeQueryClient().clear();
    const nullData = { ...initialData, candidates: initialData.candidates.map((entry) => ({ ...entry, netApy: null })) };
    const unknown = render(<SavingsExperience now={testNow} initialData={nullData} session={session()}
      balanceStatus="ready" balancePositions={balancePositions({ [GAUNTLET]: "100000000" })} />);
    expect((await page().findAllByRole("img", { name: "$100.00" })).length).toBeGreaterThan(0);
    expect(page().getByRole("region", { name: "Save" }).textContent).not.toMatch(/APY|Earning|unavailable/i);
    unknown.rerender(<SavingsExperience now={testNow} initialData={nullData} session={session()}
      balanceStatus="ready" balancePositions={balancePositions()} />);
    expect(await page().findByRole("heading", { name: "Start saving" })).toBeTruthy();
    cleanup();
    getHomeQueryClient().clear();
    const zeroData = { ...initialData, candidates: initialData.candidates.map((entry) => ({ ...entry, netApy: 0 })) };
    const zero = render(<SavingsExperience now={testNow} initialData={zeroData}
      session={session()} balanceStatus="ready" balancePositions={balancePositions({ [GAUNTLET]: "100000000" })} />);
    expect(await page().findByText("Earning ~0%")).toBeTruthy();
    zero.rerender(<SavingsExperience now={testNow} initialData={zeroData}
      session={session()} balanceStatus="ready" balancePositions={balancePositions()} />);
    expect(await page().findByRole("heading", { name: "Start saving" })).toBeTruthy();
  });

  test("shows one Get started in the unfunded intro, opens Deposit, and restores focus on close", async () => {
    render(
      <SavingsExperience
        now={testNow}
        initialData={initialData}
        session={session()}
        balanceStatus="ready"
        balancePositions={balancePositions()}
        availableUsdcBaseUnits="50000000"
        prepareMoneyAction={async () => preparedAction("savings-deposit")}
        executeMoneyAction={async () => ({ id: "action-1", status: "confirmed" })}
      />,
    );

    expect(await page().findByRole("heading", { name: "Start saving" })).toBeTruthy();
    const buttons = page().getAllByRole("button", { name: "Get started" });
    expect(buttons).toHaveLength(1);
    const opener = buttons[0];
    expect((opener as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(opener);
    expect(await page().findByRole("dialog", { name: "Deposit" })).toBeTruthy();
    const animationFlag = globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean };
    animationFlag.BASE_UI_ANIMATIONS_DISABLED = true;
    try {
      fireEvent.click(page().getByRole("button", { name: "Close deposit dialog" }));
      await waitFor(() => expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(opener));
    } finally {
      delete animationFlag.BASE_UI_ANIMATIONS_DISABLED;
    }
  });

  test("funded savings show Deposit and Withdraw without an intro", async () => {
    render(
      <SavingsExperience now={testNow} initialData={initialData} session={session()}
        balanceStatus="ready" balancePositions={balancePositions({ [GAUNTLET]: "100000000" })} />,
    );

    expect(await page().findByRole("button", { name: "Deposit" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Withdraw" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Start saving" })).toBeNull();
    expect(page().queryByRole("button", { name: "Get started" })).toBeNull();
  });

  test("vault-metadata failure hides the unfunded intro", async () => {
    render(
      <SavingsExperience now={testNow} session={session()}
        fetchVaults={async () => { throw new Error("offline"); }}
        balanceStatus="ready" balancePositions={balancePositions()} />,
    );

    expect(await page().findByText("Vaults are temporarily unavailable.")).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Start saving" })).toBeNull();
    expect(page().queryByRole("button", { name: "Get started" })).toBeNull();
  });

  test("signed-out Save shows the intro with a disabled Get started", async () => {
    render(<SavingsExperience now={testNow} initialData={initialData} />);

    expect(await page().findByRole("heading", { name: "Start saving" })).toBeTruthy();
    const buttons = page().getAllByRole("button", { name: "Get started" });
    expect(buttons).toHaveLength(1);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  test("retains rates through failed and null refetches, then replaces them on recovery", async () => {
    let reads = 0;
    const fetchVaults = async () => {
      reads += 1;
      if (reads === 2) throw new Error("offline");
      if (reads === 3) return { ...initialData, candidates: initialData.candidates.map((entry) => ({ ...entry, netApy: null, grossApy: null })) };
      return reads === 1 ? initialData : {
        ...initialData,
        candidates: initialData.candidates.map((entry) => ({ ...entry, netApy: 0.07 })),
      };
    };
    const view = render(<SavingsExperience now={testNow} session={session()} fetchVaults={fetchVaults}
      balanceStatus="ready" balancePositions={balancePositions({ [GAUNTLET]: "100000000" })} />);
    expect(await page().findByText("Earning ~4.10%")).toBeTruthy();
    const refetch = async () => {
      await act(async () => {
        await getHomeQueryClient().invalidateQueries({ queryKey: publicQueryKey("savings-vaults") });
      });
    };
    await refetch();
    expect(reads).toBe(2);
    expect(page().getByText("Earning ~4.10%")).toBeTruthy();
    expect(page().queryByText("Vaults are temporarily unavailable.")).toBeNull();
    await refetch();
    expect(reads).toBe(3);
    expect(page().getByText("Earning ~4.10%")).toBeTruthy();
    view.unmount();
    render(<SavingsExperience now={testNow} session={session()} fetchVaults={fetchVaults}
      balanceStatus="ready" balancePositions={balancePositions({ [GAUNTLET]: "100000000" })} />);
    expect(await page().findByText("Earning ~4.10%")).toBeTruthy();
    await refetch();
    expect(reads).toBe(4);
    expect(await page().findByText("Earning ~7.00%")).toBeTruthy();
  });

  test("shows metadata failure beside a verified funded balance and Retry refetches", async () => {
    let reads = 0;
    render(
      <SavingsExperience
        now={testNow}
        session={session()}
        fetchVaults={async () => {
          reads += 1;
          if (reads === 1) throw new Error("offline");
          return initialData;
        }}
        balanceStatus="ready"
        balancePositions={balancePositions({ [GAUNTLET]: "125000000" })}
      />,
    );

    const alert = await page().findByRole("alert");
    expect(alert.textContent).toContain("Vaults are temporarily unavailable.");
    expect(page().getByRole("region", { name: "Save" }).textContent).toContain("$125.00");
    expect(page().queryByRole("button", { name: "Deposit" })).toBeNull();
    expect(page().queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(page().queryByRole("radio")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Retry" }));

    expect(await page().findByRole("radio", { name: /Gauntlet USDC Prime/ })).toBeTruthy();
    expect(reads).toBe(2);
  });
});
