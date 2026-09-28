import "@/client/account/dom-test-harness";

import { useRef, useState } from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { getHomeQueryClient, publicQueryKey } from "@/client/query/query-client";
import { HomeShellRoutingProvider, type HomeInboundPanelState } from "@/client/home/panel-routing";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready, unavailableBalance } from "@/shared/balances/fixtures";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { AuthenticatedCashExperience, CashExperience } = await import("./cash-experience");
const { AccountWalletContext } = await import("@/client/account/cdp-client");
import type { AccountWalletClient } from "@/client/account/cdp-client";
const { savingsWithdrawTargets } = await import("./savings-withdraw-targets");
const { savingsManagement } = await import("./savings-management");
import type { CashExperienceProps } from "./cash-experience";
const { page } = await import("@/tests/helpers/dom");
const [GAUNTLET, , STEAKHOUSE] = MORPHO_V1_CANDIDATE_ADDRESSES;
const NOW = Date.parse("2026-09-10T12:04:00.000Z");
const now = () => NOW;
const session: VerifiedAccountSession = { user: { subject: "cash-test" }, smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 }, accountProvider: "cdp-embedded" };
const sessionB: VerifiedAccountSession = { user: { subject: "cash-test-b" }, smartAccount: { address: "0x2222222222222222222222222222222222222222", chainId: 8453 }, accountProvider: "cdp-embedded" };
function vault(vaultAddress: MorphoVaultCandidate["vaultAddress"], name: string, netApy: number): MorphoVaultCandidate {
  return { version: "v1", vaultAddress, name, symbol: "USDC vault", listed: true, chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 }, curatorAddress: null,
    grossApy: netApy + 0.005, netApy, feeRate: 0.1, totalAssetsRaw: "1250000000000", liquidityRaw: "850000000000",
    stateAsOf: "2026-09-10T12:00:00.000Z", blockNumber: "51026404",
    source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" },
  };
}
const metadata: MorphoVaultsResult = { version: "v1", chainId: 8453, asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [vault(GAUNTLET, "Gauntlet USDC Prime", 0.041), vault(STEAKHOUSE, "Steakhouse USDC", 0.0385)],
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: "2026-09-10T12:00:00.000Z" }, stale: false,
};
const cash = { usdc: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash("USD", "23400") } };
const held = buildBalancesSnapshotFixture({ registry: {
  ...cash,
  "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
  "morpho-re7-usdc": { balance: ready("83000000000000000000"), underlyingBalance: ready("83000000"), value: priced("USD", "8300") },
} });
const single = buildBalancesSnapshotFixture({ registry: { ...cash, "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") } } });
const empty = buildBalancesSnapshotFixture({ registry: cash });
const noop = () => undefined;
const preparedInputs: unknown[] = [];
const routeCalls: string[] = [];
const prepareMoneyAction = async (_endpoint: string, input: unknown): Promise<PreparedMoneyAction> => { preparedInputs.push(input); throw new Error("Preparation intentionally unavailable"); };
const executeMoneyAction = async (): Promise<never> => { throw new Error("Not part of this test"); };

function Surface({ view = "savings", snapshot = held, status = "ready", onOpenSavings = noop, nowFn = now, onPrepare = prepareMoneyAction, onExecute = executeMoneyAction, fetchVaults }: { view?: "cash" | "savings"; snapshot?: BalancesSnapshot | null; status?: "ready" | "loading" | "failed"; onOpenSavings?: () => void; nowFn?: () => number; onPrepare?: CashExperienceProps["prepareMoneyAction"]; onExecute?: CashExperienceProps["executeMoneyAction"]; fetchVaults?: CashExperienceProps["fetchVaults"] }) {
  return <main><CashExperience view={view} snapshot={snapshot} balanceStatus={status} session={session} now={nowFn} fetchVaults={fetchVaults} onOpenSavings={onOpenSavings} onAddMoney={noop} onRetryBalances={noop} prepareMoneyAction={onPrepare} executeMoneyAction={onExecute} /></main>;
}
function OwnerSwitchSurface({ snapshot }: { snapshot: BalancesSnapshot }) {
  const [active, setActive] = useState(session);
  return (
    <main>
      <button onClick={() => setActive(sessionB)}>Switch verified account</button>
      <CashExperience view="savings" snapshot={snapshot} balanceStatus="ready" session={active} now={now} onOpenSavings={noop} onAddMoney={noop} onRetryBalances={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} />
    </main>
  );
}

function SignInRoute({ initialFlow, snapshot }: { initialFlow: "save-deposit"; snapshot: BalancesSnapshot }) {
  const [flow, setFlow] = useState<string | null>(initialFlow);
  const [active, setActive] = useState<VerifiedAccountSession | null>(null);
  const routing = {
    state: { flow } as HomeInboundPanelState, popRevision: 0, rootRequest: null, openPanel: noop,
    canOpenAssetDetail: () => false, openAssetDetail: () => false,
    setFlow: (next: string) => { setFlow(next); return true; },
    clearFlow: () => { setFlow(null); },
  };
  return <HomeShellRoutingProvider value={routing as Parameters<typeof HomeShellRoutingProvider>[0]["value"]}>
    <button onClick={() => setActive(session)}>Verify account</button>
    <main><CashExperience view="savings" snapshot={snapshot} balanceStatus="ready" session={active} now={now} onOpenSavings={noop} onAddMoney={noop} onRetryBalances={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} /></main>
  </HomeShellRoutingProvider>;
}

function Route({ initialFlow, snapshot, status = "ready", deferClear = false, onPrepare, onExecute, fetchVaults }: { initialFlow: "save-deposit" | "save-withdraw" | null; snapshot: BalancesSnapshot; status?: CashExperienceProps["balanceStatus"]; deferClear?: boolean; onPrepare?: CashExperienceProps["prepareMoneyAction"]; onExecute?: CashExperienceProps["executeMoneyAction"]; fetchVaults?: CashExperienceProps["fetchVaults"] }) {
  const [flow, setFlow] = useState<string | null>(initialFlow);
  const pushedFlow = useRef<string | null>(initialFlow);
  const routing = {
    state: { flow } as HomeInboundPanelState, popRevision: 0, rootRequest: null, openPanel: noop,
    canOpenAssetDetail: () => false, openAssetDetail: () => false,
    setFlow: (next: string) => { pushedFlow.current = next; routeCalls.push(`push:${next}`); setFlow(next); return true; },
    clearFlow: ({ mode }: { mode?: "replace" | "push" } = {}) => { routeCalls.push(`clear:${mode}`); if (!deferClear) setFlow(null); },
  };
  return <HomeShellRoutingProvider value={routing as Parameters<typeof HomeShellRoutingProvider>[0]["value"]}>
    <div data-shell-back><button onClick={() => setFlow(null)}>Browser Back</button></div>
    <div data-shell-forward><button onClick={() => setFlow(pushedFlow.current)}>Browser Forward</button></div>
    <Surface snapshot={snapshot} status={status} onPrepare={onPrepare} onExecute={onExecute} fetchVaults={fetchVaults} />
  </HomeShellRoutingProvider>;
}
function cached(metadataValue: MorphoVaultsResult = metadata) { getHomeQueryClient().setQueryData(publicQueryKey("savings-vaults"), metadataValue); }
function preparedDeposit(): PreparedMoneyAction {
  return {
    id: "cash-deposit-1", kind: "savings-deposit", title: "Deposit USDC",
    createdAt: "2026-09-10T12:00:00.000Z", expiresAt: "2099-09-10T12:00:00.000Z", calls: [], warnings: [],
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "1000000000000000000", direction: "receive", estimated: true },
    ],
    metadata: {
      product: "savings", operation: "deposit", vaultAddress: GAUNTLET, vaultName: metadata.candidates[0]!.name,
      network: { name: "Base", chainId: 8453 }, feeWad: "100000000000000000", limitBaseUnits: "250000000",
      previewSharesBaseUnits: "1000000000000000000", shareDecimals: 18, minimumSharesBaseUnits: "1000000000000000000",
      exchangeConstraint: "deposit-minimum-shares-or-revert",
      discoveryRate: { status: "current", netApy: "0.041", fetchedAt: metadata.source.fetchedAt, stateAsOf: "2026-09-10T12:00:00.000Z" },
      source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789041840" },
    },
    owner: { subject: session.user.subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
  };
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); preparedInputs.length = 0; routeCalls.length = 0; });

describe("Cash L2", () => {
  test("routes an inbound deposit to the highest-rate vault and normalizes Back history", async () => {
    cached();
    render(<Route initialFlow="save-deposit" snapshot={held} />);
    await page().findByRole("dialog", { name: "Deposit" });
    const amount = await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    expect(within(page().getByRole("dialog", { name: "Deposit" })).getByText("$234.00 available")).toBeTruthy();
    fireEvent.change(amount, { target: { value: "2" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "2000000" }]));
    expect(routeCalls.slice(0, 2)).toEqual(["clear:replace", "push:save-deposit"]);
    fireEvent.click(page().getByRole("button", { name: "Browser Back", hidden: true }));
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull());
  });
  test("an unreadable open sheet clears its route once across rerenders and restores shell Back focus", async () => {
    cached();
    const unreadable = buildBalancesSnapshotFixture({ registry: { ...cash, usdc: { balance: unavailableBalance, value: { status: "unavailable" } } } });
    const view = render(<Route initialFlow="save-deposit" snapshot={held} deferClear />);
    await page().findByRole("dialog", { name: "Deposit" });
    routeCalls.length = 0;
    view.rerender(<Route initialFlow="save-deposit" snapshot={unreadable} deferClear />);
    await waitFor(() => expect(routeCalls).toEqual(["clear:replace"]));
    view.rerender(<Route initialFlow="save-deposit" snapshot={unreadable} deferClear />);
    view.rerender(<Route initialFlow="save-deposit" snapshot={unreadable} status="failed" deferClear />);
    expect(routeCalls).toEqual(["clear:replace"]);
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Browser Back", hidden: true })));
  });
  test("an unreadable balance closes a management-entry money journey instead of returning to its tray", async () => {
    cached();
    const unavailable = buildBalancesSnapshotFixture({ registry: { ...cash, usdc: { balance: unavailableBalance, value: { status: "unavailable" } },
      "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
    } });
    const view = render(<Surface snapshot={single} />);
    const row = await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" });
    row.focus();
    fireEvent.click(row);
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    view.rerender(<Surface snapshot={unavailable} />);
    await waitFor(() => expect(Boolean(page().queryByRole("dialog"))).toBe(false));
    expect(document.activeElement === row).toBe(true);
  });
  test("a confirmed sheet remains open and never clears its route when balances fail", async () => {
    cached();
    const view = render(<Route initialFlow="save-deposit" snapshot={held}
      onPrepare={async () => preparedDeposit()}
      onExecute={async (action) => ({ id: action.id, status: "submitted" })} />);
    const dialog = await page().findByRole("dialog", { name: "Deposit" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit $1.00" }));
    await page().findByRole("heading", { name: "Depositing $1.00 to Save" });
    routeCalls.length = 0;
    view.rerender(<Route initialFlow="save-deposit" snapshot={held} status="failed"
      onPrepare={async () => preparedDeposit()}
      onExecute={async (action) => ({ id: action.id, status: "submitted" })} />);
    expect(page().getByRole("dialog", { name: "Deposit" })).toBeTruthy();
    expect(routeCalls).toEqual([]);
  });
  test("routes an inbound withdrawal to the sole funded vault", async () => {
    cached();
    render(<Route initialFlow="save-withdraw" snapshot={single} />);
    expect(within(await page().findByRole("dialog", { name: "Withdraw" })).getByText("$800.00 available")).toBeTruthy();
  });
  test("an inbound withdrawal with two funded vaults clears the flow and leaves the tappable list", async () => {
    cached();
    render(<Route initialFlow="save-withdraw" snapshot={held} />);
    await waitFor(() => expect(routeCalls).toEqual(["clear:replace", "push:save-withdraw", "clear:replace"]));
    expect(page().queryByRole("dialog")).toBeNull();
    expect(page().getByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" })).toBeTruthy();
    expect(page().getByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" })).toBeTruthy();
  });
  test("an inbound withdrawal without a funded vault clears the flow", async () => {
    cached();
    render(<Route initialFlow="save-withdraw" snapshot={empty} />);
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Withdraw" })).toBeNull());
    expect(page().queryByRole("region", { name: "Your savings" })).toBeNull();
    await waitFor(() => expect(routeCalls).toEqual(["clear:replace", "push:save-withdraw", "clear:replace"]));
  });
  test("withdraw targets use configured fallback only for held configured vaults", () => {
    const missing = { ...metadata, candidates: [metadata.candidates[1]!] };
    const [target] = savingsWithdrawTargets(single, missing);
    expect(target?.candidate.vaultAddress).toBe(GAUNTLET);
    expect(target?.candidate.listed).toBe(false);
    expect(target?.candidate.source.provider).toBe("Base JSON-RPC");
    expect(savingsWithdrawTargets(single, metadata)[0]?.candidate).toBe(metadata.candidates[0]);
    expect(savingsWithdrawTargets(held, null)).toHaveLength(2);
    const unconfigured = { ...single, holdings: single.holdings.map((holding) =>
      holding.kind === "vault-share" && holding.contractAddress?.toLowerCase() === GAUNTLET.toLowerCase()
        ? { ...holding, contractAddress: "0x9999999999999999999999999999999999999999" as const }
        : holding
    ) };
    expect(savingsWithdrawTargets(unconfigured, null)).toEqual([]);
    expect(savingsWithdrawTargets(null, metadata)).toEqual([]);
  });
  test("a routed withdrawal opens the configured held vault during a rate failure", async () => {
    render(<Route initialFlow="save-withdraw" snapshot={single} fetchVaults={async () => { throw new Error("Rates unavailable"); }} />);
    const dialog = await page().findByRole("dialog", { name: "Withdraw" });
    expect(within(dialog).getByText("$800.00 available")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]));
    expect(routeCalls).toEqual(["clear:replace", "push:save-withdraw"]);
  });
  test("a routed withdrawal opens a configured held vault missing from metadata", async () => {
    cached({ ...metadata, candidates: [metadata.candidates[1]!] });
    render(<Route initialFlow="save-withdraw" snapshot={single} />);
    expect(within(await page().findByRole("dialog", { name: "Withdraw" })).getByText("$800.00 available")).toBeTruthy();
  });
  test("two held vaults clear the routed withdrawal during a rate failure and leave the list", async () => {
    render(<Route initialFlow="save-withdraw" snapshot={held} fetchVaults={async () => { throw new Error("Rates unavailable"); }} />);
    await waitFor(() => expect(routeCalls.at(-1)).toBe("clear:replace"));
    expect(page().queryByRole("dialog")).toBeNull();
    expect(page().getByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" })).toBeTruthy();
    expect(page().getByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" })).toBeTruthy();
  });
  test("balance failure clears a routed withdrawal", async () => {
    render(<Route initialFlow="save-withdraw" snapshot={single} status="failed" />);
    await waitFor(() => expect(routeCalls.at(-1)).toBe("clear:replace"));
    expect(page().queryByRole("dialog", { name: "Withdraw" })).toBeNull();
  });
  test("rate failure clears a routed deposit", async () => {
    render(<Route initialFlow="save-deposit" snapshot={single} fetchVaults={async () => { throw new Error("Rates unavailable"); }} />);
    await waitFor(() => expect(routeCalls.at(-1)).toBe("clear:replace"));
    expect(page().queryByRole("dialog", { name: "Deposit" })).toBeNull();
  });
  test("an unconfigured held vault clears the routed withdrawal", async () => {
    const unconfigured = { ...single, holdings: single.holdings.map((holding) =>
      holding.kind === "vault-share" && holding.contractAddress?.toLowerCase() === GAUNTLET.toLowerCase()
        ? { ...holding, contractAddress: "0x9999999999999999999999999999999999999999" as const }
        : holding
    ) };
    cached();
    render(<Route initialFlow="save-withdraw" snapshot={unconfigured} />);
    await waitFor(() => expect(routeCalls.at(-1)).toBe("clear:replace"));
    expect(page().queryByRole("dialog", { name: "Withdraw" })).toBeNull();
  });
  test("returning from savings restores focus to the US dollar row", async () => {
    cached();
    function Journey() {
      const [view, setView] = useState<"cash" | "savings">("cash");
      return <><button onClick={() => setView("cash")}>Back</button><Surface view={view} onOpenSavings={() => setView("savings")} /></>;
    }
    render(<Journey />);
    fireEvent.click(await page().findByRole("button", { name: /^US dollar/ }));
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: /^US dollar/ })));
  });
  test("unreadable balances never render as zero", async () => {
    cached();
    const unknown = buildBalancesSnapshotFixture({ registry: { ...cash, "morpho-steakhouse-usdc": { balance: unavailableBalance, underlyingBalance: unavailableBalance, value: { status: "unavailable" } } } });
    render(<Surface snapshot={unknown} />);
    const hero = page().getByLabelText("Savings balance");
    expect(hero.textContent).not.toContain("$0.00");
    expect(within(hero).getByText("Unavailable")).toBeTruthy();
  });
  test("a verified session without a wallet shows unavailable balances without an ineffective retry", async () => {
    const wallet = { status: "verified", verification: "server", session: { ...session, smartAccount: null },
      fetchBalances: async () => { throw new Error("Not part of this test"); }, fetchAccountResource: async () => metadata,
      prepareMoneyAction, executeMoneyAction } as unknown as AccountWalletClient;
    const view = render(<AccountWalletContext.Provider value={wallet}><main><AuthenticatedCashExperience view="cash" onOpenSavings={noop} /></main></AccountWalletContext.Provider>);
    expect(await view.findByLabelText("Balance unavailable")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(view.queryByRole("button", { name: "Add money" })).toBeNull();
  });
  test("does not offer management without a verified session", async () => {
    cached();
    render(<main><CashExperience view="savings" snapshot={held} balanceStatus="ready" session={null} now={now} onOpenSavings={noop} onAddMoney={noop} onRetryBalances={noop} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} /></main>);
    const positions = await page().findByRole("region", { name: "Your savings" });
    expect(within(positions).queryByRole("button", { name: /Manage/ })).toBeNull();
    expect(page().queryByRole("dialog")).toBeNull();
    expect(page().queryByRole("button", { name: "Deposit more" })).toBeNull();
    expect(page().queryByRole("button", { name: "Withdraw" })).toBeNull();
  });
  test("a rate outage does not block withdrawal from a known vault", async () => {
    cached({ ...metadata, candidates: [] });
    render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect((within(dialog).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("a single held position opens its management tray", async () => {
    cached();
    const steakhouseOnly = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-re7-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
    } });
    render(<Surface snapshot={steakhouseOnly} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    const dialog = await page().findByRole("dialog", { name: "Steakhouse USDC" });
    expect(within(dialog).getByText("Saved")).toBeTruthy();
    expect(within(dialog).getByRole("img", { name: "$800.00" })).toBeTruthy();
    expect(within(dialog).getByText("3.85% APY · variable")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Deposit more" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Withdraw" })).toBeTruthy();
  });
  test("Deposit more is pinned to the selected vault", async () => {
    cached();
    render(<Surface snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    await page().findByRole("dialog", { name: "Steakhouse USDC" });
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    const amount = await page().findByRole("textbox", { name: "Amount" });
    fireEvent.change(amount, { target: { value: "2.25" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: STEAKHOUSE, amountBaseUnits: "2250000" }]));
  });
  test("Withdraw targets the selected position", async () => {
    cached();
    render(<Surface snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    fireEvent.click(within(await page().findByRole("dialog", { name: "Gauntlet USDC Prime" })).getByRole("button", { name: "Withdraw" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value: "4.50" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: GAUNTLET, amountBaseUnits: "4500000" }]));
  });
  test("verifying an account preserves the inbound savings flow", async () => {
    cached();
    render(<SignInRoute initialFlow="save-deposit" snapshot={held} />);
    fireEvent.click(page().getByRole("button", { name: "Verify account" }));
    await page().findByRole("dialog", { name: "Deposit" });
  });

  test("a position refreshed to zero shows nothing saved instead of unavailable", async () => {
    cached();
    const zeroVault = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": { balance: ready("0"), underlyingBalance: ready("0"), value: priced("USD", "0") },
    } });
    const view = render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const tray = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect((within(tray).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(<Surface snapshot={zeroVault} />);
    await waitFor(() => expect(within(tray).queryByText("Nothing saved to withdraw.")).toBeTruthy());
    expect(within(tray).queryByText("Unavailable")).toBeNull();
    expect((within(tray).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a vault missing from a complete snapshot is absent, not unreadable", () => {
    const snapshot = buildBalancesSnapshotFixture();
    const without = { ...snapshot, holdings: snapshot.holdings.filter((holding) => holding.contractAddress?.toLowerCase() !== GAUNTLET.toLowerCase()) };
    const management = savingsManagement({ address: GAUNTLET, snapshot: without, metadata: null, nowMs: NOW, actionsAvailable: true, usdcBaseUnits: null, usdcUnavailable: false });
    expect(management.absent).toBe(true);
    expect(management.savedBaseUnits).toBe("0");
    expect(management.unreadable).toBe(false);
    expect(management.withdraw.reason).toBe("Nothing saved to withdraw.");
  });
  test("a vault missing from a partial snapshot stays unavailable", () => {
    const snapshot = buildBalancesSnapshotFixture({ coverage: { registry: "partial" } });
    const without = { ...snapshot, holdings: snapshot.holdings.filter((holding) => holding.contractAddress?.toLowerCase() !== GAUNTLET.toLowerCase()) };
    const management = savingsManagement({ address: GAUNTLET, snapshot: without, metadata: null, nowMs: NOW, actionsAvailable: true, usdcBaseUnits: null, usdcUnavailable: false });
    expect(management.absent).toBe(false);
    expect(management.savedBaseUnits).toBeNull();
    expect(management.withdraw.reason).toBe("Couldn't check this balance.");
  });
  test("an account change clears the selected tray instead of reopening it for the new owner", async () => {
    cached();
    render(<OwnerSwitchSurface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    fireEvent.click(page().getByText("Switch verified account"));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
  });

  test("Back returns to the tray and X exits the journey", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={single} />);
    const row = await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" });
    row.focus();
    fireEvent.click(row);
    await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(await page().findByRole("dialog", { name: "Gauntlet USDC Prime" })).toBeTruthy();
    expect(routeCalls).toEqual(["push:save-deposit", "clear:undefined"]);
    fireEvent.click(page().getByRole("button", { name: "Close Gauntlet USDC Prime details" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(document.activeElement === row).toBe(true);
  }, 60_000);
  test("close and reopen resets the draft and keeps the correct vault", async () => {
    cached();
    render(<Surface snapshot={held} onPrepare={async (_kind, input) => { preparedInputs.push(input); return preparedDeposit(); }} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    await page().findByText("Saved");
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await page().findByRole("dialog", { name: "Confirm" });
    fireEvent.click(page().getAllByRole("button", { name: "Back" }).at(-1)!);
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(page().getByRole("button", { name: "Close Gauntlet USDC Prime details" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    fireEvent.click(page().getByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    await page().findByText("Saved");
    fireEvent.click(page().getByRole("button", { name: "Deposit more" }));
    const amount = await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }) as HTMLInputElement;
    expect(amount.value).toBe("");
    fireEvent.change(amount, { target: { value: "2" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(preparedInputs).toEqual([
      { kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" },
      { kind: "deposit", vaultAddress: STEAKHOUSE, amountBaseUnits: "2000000" },
    ]);
  }, 60_000);
  test("modal Back keeps the selected vault for a browser Forward", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "2" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: STEAKHOUSE, amountBaseUnits: "2000000" }]));
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Browser Forward", hidden: true }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "3" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs.at(-1)).toEqual({ kind: "deposit", vaultAddress: STEAKHOUSE, amountBaseUnits: "3000000" }));
  }, 20_000);
  test("modal Back keeps the selected position for a browser Forward withdrawal", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Withdraw" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: STEAKHOUSE, amountBaseUnits: "1000000" }]));
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Browser Forward", hidden: true }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "2" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs.at(-1)).toEqual({ kind: "withdraw", vaultAddress: STEAKHOUSE, amountBaseUnits: "2000000" }));
  }, 20_000);
  test("switching actions after modal Back targets the switched vault", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Withdraw" }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "withdraw", vaultAddress: STEAKHOUSE, amountBaseUnits: "1000000" }]));
  }, 20_000);
  test("closing the tray after modal Back leaves Forward an ordinary inbound flow", async () => {
    cached();
    render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Close Steakhouse USDC details" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    fireEvent.click(page().getByRole("button", { name: "Browser Forward", hidden: true }));
    fireEvent.change(await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 }), { target: { value: "1" } });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(preparedInputs).toEqual([{ kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "1000000" }]));
  }, 60_000);
  test("an unavailable balance after modal Back never reopens the money step", async () => {
    cached();
    const view = render(<Route initialFlow={null} snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(await page().findByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    view.rerender(<Route initialFlow={null} snapshot={held} status="failed" />);
    await waitFor(() => expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull());
    const tray = await page().findByRole("dialog", { name: "Steakhouse USDC" });
    expect((within(tray).getByRole("button", { name: "Deposit more" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(tray).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(true);
  }, 20_000);
  test("Back from the amount step restores focus to the chosen action", async () => {
    cached();
    render(<Surface snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(page().getByRole("button", { name: "Withdraw" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Withdraw" })));
  }, 20_000);
  test("a tray opened without a chosen action focuses the saved balance", async () => {
    cached();
    render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const hero = page().getByRole("img", { name: "$800.00" }).closest("p");
    await waitFor(() => expect(document.activeElement).toBe(hero));
  }, 20_000);
  test("Back restores focus to the most recently chosen action", async () => {
    cached();
    render(<Surface snapshot={held} />);
    fireEvent.click(await page().findByRole("button", { name: /^Steakhouse USDC/, description: "Manage Steakhouse USDC" }));
    fireEvent.click(page().getByRole("button", { name: "Deposit more" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Deposit more" })));
    fireEvent.click(page().getByRole("button", { name: "Withdraw" }));
    await page().findByRole("textbox", { name: "Amount" }, { timeout: 10_000 });
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.activeElement).toBe(page().getByRole("button", { name: "Withdraw" })));
  }, 20_000);
  test("an unlisted held position permits withdrawal", async () => {
    cached({ ...metadata, candidates: [metadata.candidates[1]!] });
    render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect((within(dialog).getByRole("button", { name: "Deposit more" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText("Deposits are paused for this vault.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("an unreadable held position shows an honest withdrawal reason", async () => {
    cached();
    const unreadable = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": { balance: unavailableBalance, underlyingBalance: unavailableBalance, value: { status: "unavailable" } },
    } });
    render(<Surface snapshot={unreadable} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect(within(dialog).getByText("Unavailable")).toBeTruthy();
    expect(dialog.textContent).not.toContain("$0.00");
    expect((within(dialog).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText("Couldn't check this balance.")).toBeTruthy();
  });
  test("zero vault liquidity is informational and withdrawal remains enabled", async () => {
    cached({ ...metadata, candidates: [{ ...metadata.candidates[0]!, liquidityRaw: "0" }, metadata.candidates[1]!] });
    render(<Surface snapshot={single} />);
    fireEvent.click(await page().findByRole("button", { name: /^Gauntlet USDC Prime/, description: "Manage Gauntlet USDC Prime" }));
    const dialog = await page().findByRole("dialog", { name: "Gauntlet USDC Prime" });
    expect(within(dialog).getByText("No liquidity available to withdraw right now.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("adds only savings growth and reconciles a new authoritative snapshot once", async () => {
    cached();
    let clock = NOW;
    const getNow = () => clock;
    const first = { ...held, block: { ...held.block, timestamp: String(Math.floor((NOW - 120_000) / 1000)) } };
    const observed = buildBalancesSnapshotFixture({ registry: { ...cash,
      "morpho-steakhouse-usdc": { balance: ready("801000000000000000000"), underlyingBalance: ready("801000000"), value: priced("USD", "80100") },
      "morpho-re7-usdc": { balance: ready("84000000000000000000"), underlyingBalance: ready("84000000"), value: priced("USD", "8400") },
    } });
    const next = { ...observed, block: { ...observed.block, number: "35123457", hash: `0x${"b".repeat(64)}`, timestamp: String(Math.floor(NOW / 1000)) } } as BalancesSnapshot;
    const view = render(<MoneyMotionProvider reducedMotion={false}><Surface view="cash" snapshot={first} nowFn={getNow} /></MoneyMotionProvider>);
    const balance = () => page().getByLabelText("Cash balance").querySelector<HTMLElement>("[role=img]")?.getAttribute("aria-label");
    expect(balance()).toBe("$1,117.00");
    clock += 15_000;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(balance()).toMatch(/^\$1,117\.\d{6}$/));
    view.rerender(<MoneyMotionProvider reducedMotion={false}><Surface view="cash" snapshot={next} nowFn={getNow} /></MoneyMotionProvider>);
    await waitFor(() => expect(balance()).toBe("$1,119.00"));
  });
  test("reduced motion holds the authoritative balance without animating", async () => {
    cached();
    let clock = NOW;
    const getNow = () => clock;
    const first = { ...held, block: { ...held.block, timestamp: String(Math.floor((NOW - 120_000) / 1000)) } };
    render(<MoneyMotionProvider reducedMotion><Surface view="cash" snapshot={first} nowFn={getNow} /></MoneyMotionProvider>);
    const balance = () => page().getByLabelText("Cash balance").querySelector<HTMLElement>("[role=img]");
    expect(balance()?.getAttribute("aria-label")).toBe("$1,117.00");
    clock += 120_000;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(balance()?.getAttribute("aria-label")).toBe("$1,117.00");
    expect(balance()?.getAttribute("data-animated")).toBe("false");
  });
});
