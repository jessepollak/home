import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { HttpResponse, http } from "msw";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient, publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { HomeMoneySummary } from "@/client/home/home-overview";
import { ShellHeader } from "@/client/home/shell-chrome";
import { SavingsMoneyDialog } from "@/client/savings/savings-actions";
import { SavingsDialogFixtureProvider } from "@/client/savings/savings-dialog-fixture";
import { formatExactSavingsApy, summarizeSavingsPortfolio } from "@/client/savings/portfolio-summary";
import { savingsTeaserApyLabel } from "@/client/savings/savings-teaser-apy";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready, unavailableBalance } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import { selectVaultPositions } from "@/shared/balances/select";
import { formatUsdStablecoinAmount } from "@/shared/formatting";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import { parseVaultsResult } from "@/shared/savings/contracts/vaults";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { CashOverviewExploration, SavingsDetailExploration } from "./cash-overview";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const TIME = "2026-09-10T12:04:00.000Z";
const NOW = Date.parse(TIME);
const [GAUNTLET, SPARK, STEAKHOUSE] = MORPHO_V1_CANDIDATE_ADDRESSES;
const noop = () => undefined;
const addMoney = fn();
const back = fn();
const retryBalances = fn();
const earnings = new EventTarget();
const snapshotChanges = new EventTarget();
const journey = { prepared: [] as Array<{ endpoint: string; input: unknown }>, executed: [] as PreparedMoneyAction[] };
const session: VerifiedAccountSession = {
  user: { subject: "cash-l2-story-owner" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const account = { status: "verified", isSignedIn: true, ownerKey: null, session: null } as unknown as ComponentProps<typeof ShellHeader>["account"];

function candidate(vaultAddress: MorphoVaultCandidate["vaultAddress"], name: string, netApy: number | null): MorphoVaultCandidate {
  return {
    version: "v1", vaultAddress, name, symbol: "USDC vault", listed: true, chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    curatorAddress: null, grossApy: netApy === null ? null : netApy + 0.005, netApy, feeRate: 0.1,
    totalAssetsRaw: "1250000000000", liquidityRaw: "850000000000", stateAsOf: TIME, blockNumber: "51026404",
    source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: TIME },
  };
}

const metadata: MorphoVaultsResult = {
  version: "v1", chainId: 8453, asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [candidate(GAUNTLET, "Gauntlet USDC Prime", 0.041), candidate(STEAKHOUSE, "Steakhouse USDC", 0.0385), candidate(SPARK, "Spark USDC Vault", 0.0362)],
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: TIME },
  stale: false,
};

const cashRegistry = {
  usdc: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash("USD", "23400") },
  idrx: { balance: ready("190000000"), value: priced("USD", "11700"), cashValue: pricedCash("IDR", "190000000", 2) },
};
const fundedSnapshot = buildBalancesSnapshotFixture({ registry: {
  ...cashRegistry,
  "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
  "morpho-re7-usdc": { balance: ready("83000000000000000000"), underlyingBalance: ready("83000000"), value: priced("USD", "8300") },
} });
const emptySnapshot = buildBalancesSnapshotFixture();
const savingsOnlySnapshot = buildBalancesSnapshotFixture({ registry: {
  "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
} });
const cashOnlySnapshot = buildBalancesSnapshotFixture({ registry: cashRegistry });
const partialHoldingSnapshot = buildBalancesSnapshotFixture({ registry: {
  ...cashRegistry,
  idrx: { balance: ready("190000000"), value: { status: "unpriced", reason: "price-unavailable" }, cashValue: pricedCash("IDR", "190000000", 2) },
  "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
  "morpho-re7-usdc": { balance: ready("83000000000000000000"), underlyingBalance: ready("83000000"), value: priced("USD", "8300") },
} });
const unpricedHoldingSnapshot = buildBalancesSnapshotFixture({ registry: {
  ...cashRegistry,
  idrx: { balance: ready("190000000"), value: { status: "unpriced", reason: "price-unavailable" }, cashValue: { status: "unpriced", reason: "price-unavailable" } },
} });
const cashValueUnpricedSnapshot = buildBalancesSnapshotFixture({ registry: {
  ...cashRegistry,
  idrx: { balance: ready("190000000"), value: priced("USD", "11700"), cashValue: { status: "unpriced", reason: "price-unavailable" } },
} });
const holdingUnavailableSnapshot = buildBalancesSnapshotFixture({ registry: {
  ...cashRegistry,
  idrx: { balance: unavailableBalance, value: { status: "unavailable" }, cashValue: { status: "unavailable" } },
} });
const localHoldingUnavailableSnapshot = buildBalancesSnapshotFixture({ region: "ID", registry: {
  usdc: { balance: ready("234000000") },
  idrx: { balance: unavailableBalance },
} });
const usdcUnavailableSnapshot = buildBalancesSnapshotFixture({ registry: {
  ...cashRegistry,
  usdc: { balance: unavailableBalance, value: { status: "unavailable" }, cashValue: { status: "unavailable" } },
  "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
} });
const partialSavingsSnapshot = buildBalancesSnapshotFixture({ registry: {
  ...cashRegistry,
  "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
  "morpho-re7-usdc": { balance: unavailableBalance, underlyingBalance: unavailableBalance, value: { status: "unavailable" } },
} });

function preparedAction(vault: MorphoVaultCandidate, kind: string, amountBaseUnits: string): PreparedMoneyAction {
  const withdraw = kind === "savings-withdraw";
  return {
    id: `cash-l2-${kind}`, kind: withdraw ? "savings-withdraw" : "savings-deposit",
    title: withdraw ? "Withdraw USDC" : "Deposit USDC",
    createdAt: TIME, expiresAt: "2099-09-10T12:03:00.000Z", calls: [],
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits, direction: withdraw ? "receive" : "spend" },
      { assetId: "vault", symbol: "vault shares", decimals: 18, amountBaseUnits: "24000000000000000000", direction: withdraw ? "spend" : "receive", estimated: true },
    ], warnings: [],
    metadata: {
      product: "savings", operation: withdraw ? "withdraw" : "deposit", vaultAddress: vault.vaultAddress, vaultName: vault.name,
      network: { name: "Base", chainId: 8453 }, feeWad: "100000000000000000", limitBaseUnits: "250000000",
      previewSharesBaseUnits: "24000000000000000000", shareDecimals: 18,
      exchangeConstraint: withdraw ? "withdraw-exact-assets-or-revert" : "deposit-minimum-shares-or-revert",
      ...(withdraw ? {} : { minimumSharesBaseUnits: "23976000000000000000" }),
      discoveryRate: vault.netApy === null
        ? { status: "unavailable", netApy: null, fetchedAt: null, stateAsOf: null }
        : { status: "current", netApy: String(vault.netApy), fetchedAt: TIME, stateAsOf: TIME },
      source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1789041840" },
    },
    owner: { subject: session.user.subject, address: ACCOUNT, chainId: 8453, accountProvider: session.accountProvider },
  };
}

async function fetchVaults(signal?: AbortSignal): Promise<MorphoVaultsResult> {
  const response = await fetch("/api/savings/vaults", { signal });
  if (!response.ok) throw new Error("Vault request failed");
  const result = parseVaultsResult(await response.json());
  if (!result) throw new Error("Vault metadata invalid");
  return result;
}

type SurfaceProps = {
  snapshot: BalancesSnapshot | null;
  balanceStatus?: "ready" | "loading" | "failed";
  vaultStatus?: "ready" | "loading";
  homeParity?: boolean;
  pendingExecution?: boolean;
  reducedMotion?: boolean;
  ticking?: boolean;
  snapshotToggle?: boolean;
  initialView?: "cash" | "savings";
};

function CashStorySurface({ snapshot, balanceStatus: initialBalanceStatus = "ready", vaultStatus = "ready", homeParity = false, pendingExecution = false, ticking = false, snapshotToggle = false, reducedMotion = false, initialView = "cash" }: SurfaceProps) {
  const [view, setView] = useState(initialView);
  const [mode, setMode] = useState<"deposit" | "withdraw" | null>(null);
  const [lastMode, setLastMode] = useState<"deposit" | "withdraw">("deposit");
  const opener = useRef<HTMLButtonElement | null>(null);
  const [targetCandidate, setTargetCandidate] = useState<MorphoVaultCandidate | null>(null);
  const clock = useRef(NOW);
  const now = useCallback(() => clock.current, []);
  const [snapshotUnavailable, setSnapshotUnavailable] = useState(false);
  const [balancesFailed, setBalancesFailed] = useState(false);
  const balanceStatus = balancesFailed ? "failed" : initialBalanceStatus;
  const restoreSavingsFocus = useRef(false);
  useEffect(() => {
    if (!restoreSavingsFocus.current) return;
    const row = document.querySelector<HTMLButtonElement>('main [aria-labelledby="cash-savings-heading"] button');
    if (!row) return;
    restoreSavingsFocus.current = false;
    row.focus();
  });
  useEffect(() => {
    if (!ticking) return;
    const advance = () => {
      clock.current += 120_000;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    earnings.addEventListener("advance", advance);
    return () => earnings.removeEventListener("advance", advance);
  }, [ticking]);
  useEffect(() => {
    if (!snapshotToggle) return;
    const unavailable = () => setSnapshotUnavailable(true);
    const funded = () => {
      setSnapshotUnavailable(false);
      setBalancesFailed(false);
    };
    const failed = () => setBalancesFailed(true);
    snapshotChanges.addEventListener("unavailable", unavailable);
    snapshotChanges.addEventListener("funded", funded);
    snapshotChanges.addEventListener("failed", failed);
    return () => {
      snapshotChanges.removeEventListener("unavailable", unavailable);
      snapshotChanges.removeEventListener("funded", funded);
      snapshotChanges.removeEventListener("failed", failed);
    };
  }, [snapshotToggle]);
  const cachedSnapshot = snapshotToggle && snapshotUnavailable ? usdcUnavailableSnapshot : ticking && snapshot ? { ...snapshot, block: { ...snapshot.block, timestamp: String(Math.floor(NOW / 1000) - 120) } } : snapshot;
  const liveSnapshot = balanceStatus === "failed" ? null : cachedSnapshot;
  const query = useHomeQuery({ queryKey: publicQueryKey("cash-l2-vaults"), queryFn: ({ signal }) => fetchVaults(signal), retry: false, staleTime: Infinity, enabled: vaultStatus !== "loading" });
  const position = liveSnapshot?.holdings.find((holding) => holding.kind === "vault-share" && holding.contractAddress?.toLowerCase() === targetCandidate?.vaultAddress.toLowerCase());
  const usdc = liveSnapshot?.holdings.find((holding) => holding.id === "usdc")?.balance;
  const availableBaseUnits = mode === "withdraw" ? position?.underlyingBalance?.status === "ready" ? position.underlyingBalance.baseUnits : null : usdc?.status === "ready" ? usdc.baseUnits : null;
  if (mode !== null && availableBaseUnits === null) setMode(null);
  const prepareMoneyAction = async (endpoint: string, input: unknown) => {
    journey.prepared.push({ endpoint, input });
    if (!targetCandidate) throw new Error("No savings vault selected");
    return preparedAction(targetCandidate, endpoint, (input as { amountBaseUnits: string }).amountBaseUnits);
  };
  const executeMoneyAction = async (action: PreparedMoneyAction): Promise<OperationResult> => {
    journey.executed.push(action);
    if (pendingExecution) return new Promise<OperationResult>(() => {});
    return { id: action.id, status: "confirmed" };
  };
  const open = (nextMode: "deposit" | "withdraw", candidate: MorphoVaultCandidate) => {
    opener.current = document.activeElement as HTMLButtonElement;
    setTargetCandidate(candidate);
    setLastMode(nextMode);
    setMode(nextMode);
  };
  const surface = useRef<HTMLDivElement | null>(null);
  const restoreDialogFocus = () => {
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected && !target.matches(":disabled")) {
      target.focus();
      return;
    }
    surface.current?.querySelector<HTMLButtonElement>("[data-shell-back] button:not(:disabled)")?.focus();
  };
  const summary = liveSnapshot ? presentBalances({ status: "ready", snapshot: liveSnapshot, error: null }).summary : null;
  const savingsSummary = liveSnapshot && query.data ? summarizeSavingsPortfolio({
    supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES,
    requiredAsset: query.data.asset,
    candidates: query.data.candidates,
    positions: selectVaultPositions(liveSnapshot),
    metadataFetchedAt: query.data.source.fetchedAt,
    nowMs: NOW,
  }) : null;
  const cashRate = balanceStatus !== "failed" && query.data ? savingsTeaserApyLabel({ summary: savingsSummary, candidates: query.data.candidates, metadata: query.data, nowMs: NOW }) : null;
  const status = vaultStatus === "loading" || query.isPending ? "loading" : query.isError ? "failed" : "ready";
  return (
    <PresentationRegionProvider regionId="US">
      <SavingsDialogFixtureProvider value={{ motion: reducedMotion ? "reduced" : "system" }}>
        <MoneyMotionProvider reducedMotion={reducedMotion ? true : undefined}>
        <div ref={surface} className="min-h-svh bg-muted/50">
          <ShellHeader isAccountSettingsOpen={false} nestedChromeTitle={view === "cash" ? "Cash" : "Savings"} nestedChromeBackLabel="Back" onNestedChromeBack={() => {
            if (view === "savings") {
              setView("cash");
              restoreSavingsFocus.current = true;
            } else back();
          }} routeMode="dashboard" activeNavigation="cash" isVerified account={account} onHome={noop} onDashboard={noop} onSignIn={noop} onSignOut={noop} onOpenSettings={noop} onCloseSettings={noop} />
          <main className={`${shellContentFrameClassName} py-4`}>
            {homeParity ? (
              <HomeMoneySummary summary={summary} isLoading={false} cashRate={cashRate} borrowOfferRate={null} destinations={{ onOpenCash: noop, onOpenInvestments: noop, onOpenBorrow: noop }} />
            ) : view === "cash" ? (
              <CashOverviewExploration snapshot={liveSnapshot} balanceStatus={balanceStatus} metadata={query.data ?? null} vaultStatus={status} nowMs={NOW} now={now} rateLabel={cashRate} onOpenSavings={() => setView("savings")} onAddMoney={addMoney} onRetryBalances={retryBalances} />
            ) : (
              <SavingsDetailExploration snapshot={liveSnapshot} balanceStatus={balanceStatus} metadata={query.data ?? null} vaultStatus={status} nowMs={NOW} now={now} onDepositVault={(candidate) => open("deposit", candidate)} onWithdrawVault={(candidate) => open("withdraw", candidate)} onRetryVaults={() => void query.refetch()} onRetryBalances={retryBalances} />
            )}
          </main>
          {targetCandidate ? <SavingsMoneyDialog open={mode !== null} mode={mode ?? lastMode} session={session} candidate={targetCandidate} availableLabel={availableBaseUnits ? `${formatUsdStablecoinAmount(availableBaseUnits)} available` : undefined} availableBaseUnits={availableBaseUnits} prepareMoneyAction={prepareMoneyAction} executeMoneyAction={executeMoneyAction} onClose={() => setMode(null)} onClosed={restoreDialogFocus} /> : null}
        </div>
        </MoneyMotionProvider>
      </SavingsDialogFixtureProvider>
    </PresentationRegionProvider>
  );
}

const meta = {
  id: "explorations-cash-l2", title: "Explorations/Cash L2", component: CashStorySurface,
  args: { snapshot: fundedSnapshot },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" }, msw: { handlers: [http.get("/api/savings/vaults", () => HttpResponse.json(metadata))] } },
  beforeEach() { getHomeQueryClient().clear(); journey.prepared.length = 0; journey.executed.length = 0; addMoney.mockClear(); back.mockClear(); retryBalances.mockClear(); },
} satisfies Meta<typeof CashStorySurface>;
export default meta;
type Story = StoryObj<typeof meta>;

async function assertButtonHeights(canvasElement: HTMLElement, cashOnly = false) {
  const screen = within(cashOnly ? canvasElement.querySelector("main")! : canvasElement.ownerDocument.body);
  for (const button of screen.getAllByRole("button")) {
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
}

const savingsRow = (canvasElement: HTMLElement) => within(canvasElement).getByRole("button", { name: /^US dollar/ });
const detail = (canvasElement: HTMLElement) => within(canvasElement.querySelector("main")!);
const vaultRow = (region: HTMLElement, name: string) => within(region).getByText(name).closest("li")!;
async function openSavings(canvasElement: HTMLElement) {
  const row = await within(canvasElement).findByRole("button", { name: /^US dollar/ });
  await waitFor(() => expect(within(canvasElement).getByRole("region", { name: "Savings" })).not.toHaveAttribute("aria-busy"));
  await userEvent.click(row);
  return detail(canvasElement);
}
async function assertFunded({ canvasElement }: { canvasElement: HTMLElement }) {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("heading", { name: "Cash", level: 1 })).toBeVisible();
  await expect(canvas.getByLabelText("Cash balance").textContent).toContain("$1,234.00");
  await expect(await within(canvas.getByLabelText("Cash balance")).findByText("4.08% APY")).toBeVisible();
  const currencies = within(canvas.getByRole("region", { name: "Currencies" }));
  await expect(currencies.getAllByRole("listitem")).toHaveLength(2);
  await expect(currencies.getByRole("img", { name: "$234.00" })).toBeVisible();
  await expect(currencies.getByText("$117.00")).toBeVisible();
  const row = savingsRow(canvasElement);
  await expect(row).toHaveAccessibleName(/US dollar.*4\.08% APY.*\$883\.00/);
  await expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await expect(canvas.getByRole("button", { name: "Add money" })).toBeVisible();
  await assertButtonHeights(canvasElement, canvasElement.getBoundingClientRect().width >= 800);
}
export const Funded: Story = { play: assertFunded };
export const FundedDesktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } }, play: assertFunded };
const mixedCaseMetadata = { ...metadata, candidates: [metadata.candidates[1], { ...metadata.candidates[0], vaultAddress: `0x${GAUNTLET.slice(2).toUpperCase()}` }, metadata.candidates[2]] };
export const ProviderAddressCasing: Story = { parameters: { msw: { handlers: [http.get("/api/savings/vaults", () => HttpResponse.json(mixedCaseMetadata))] } }, play: async ({ canvasElement }) => {
  const detailScreen = await openSavings(canvasElement);
  await userEvent.click(detailScreen.getByRole("button", { name: "Deposit" }));
  const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Deposit" });
  await userEvent.type(await within(dialog).findByRole("textbox", { name: "Amount" }), "2");
  await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await expect(within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" })).getByText("Gauntlet USDC Prime")).toBeVisible();
} };
export const HomeRowParity: Story = { args: { homeParity: true }, play: async ({ canvasElement }) => {
  const cash = await within(canvasElement).findByRole("button", { description: "Open Cash" });
  await expect(cash.textContent).toContain("$1,234.00");
  await waitFor(() => expect(cash.textContent).toContain("4.08% APY"));
  const summary = summarizeSavingsPortfolio({ supportedVaultAddresses: MORPHO_V1_CANDIDATE_ADDRESSES, requiredAsset: metadata.asset, candidates: metadata.candidates, positions: selectVaultPositions(fundedSnapshot), metadataFetchedAt: TIME, nowMs: NOW });
  if (summary.apy.status !== "available") throw new Error("Expected available weighted savings rate");
  await expect(formatExactSavingsApy(summary.apy.value)).toBe("4.08%");
} };
export const Loading: Story = { args: { snapshot: null, balanceStatus: "loading", vaultStatus: "loading" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByLabelText("Cash balance")).toHaveAttribute("aria-busy", "true");
  await expect(canvas.getByRole("region", { name: "Currencies" })).toHaveAttribute("aria-busy", "true");
  await expect(canvas.getByRole("region", { name: "Savings" })).toHaveAttribute("aria-busy", "true");
  await expect(canvasElement.querySelectorAll("[data-shimmer='row']")).toHaveLength(3);
  const button = canvas.getByRole("button", { name: "Add money" });
  await expect(button).toBeEnabled();
  await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
} };
export const SavingsRatesLoading: Story = { args: { vaultStatus: "loading" }, play: async ({ canvasElement }) => {
  const savings = within(canvasElement).getByRole("region", { name: "Savings" });
  await expect(savings).toHaveAttribute("aria-busy", "true");
  const row = savingsRow(canvasElement);
  await expect(row).toBeVisible();
  await expect(row).toHaveAccessibleName(/US dollar.*Loading rate.*\$883\.00/);
  await expect(within(savings).queryByText("Rate unavailable")).toBeNull();
  await expect(savings.querySelectorAll("[data-shimmer='row']")).toHaveLength(0);
  await userEvent.click(row);
  await expect(within(canvasElement).getByRole("heading", { name: "Savings", level: 1 })).toBeVisible();
} };
export const EmptyNux: Story = { args: { snapshot: emptySnapshot }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByLabelText("Cash balance").textContent).toContain("$0.00");
  await expect(await canvas.findByText("Earn up to 4.10% APY")).toBeVisible();
  await expect(canvas.queryByRole("region", { name: "Currencies" })).toBeNull();
  await expect(canvas.queryByRole("region", { name: "Savings" })).toBeNull();
  await expect(canvas.getByRole("button", { name: "Add money" })).toBeVisible();
  await assertButtonHeights(canvasElement);
} };
export const SavingsOnly: Story = { args: { snapshot: savingsOnlySnapshot }, play: async ({ canvasElement }) => {
  await within(canvasElement).findByRole("button", { name: /US dollar.*\$800\.00/ });
  await expect(within(canvasElement).getByLabelText("Cash balance").textContent).toContain("$800.00");
  await expect(within(canvasElement).getByRole("region", { name: "Currencies" })).toBeVisible();
} };
export const EmptyNonUsd: Story = { args: { snapshot: buildBalancesSnapshotFixture({ region: "GB" }) }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByLabelText("Cash balance").textContent).toContain("£0.00");
  await expect(await canvas.findByText("Earn up to 4.10% APY")).toBeVisible();
  await expect(canvas.queryByRole("region", { name: "Currencies" })).toBeNull();
} };
export const EmptyStaleRates: Story = { args: { snapshot: emptySnapshot }, parameters: { msw: { handlers: [http.get("/api/savings/vaults", () => HttpResponse.json({ ...metadata, stale: true }))] } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByLabelText("Cash balance").textContent).toContain("$0.00");
  await expect(await canvas.findByText("Earn up to 4.10% APY")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Add money" })).toBeVisible();
} };
export const CashNoSavings: Story = { args: { snapshot: cashOnlySnapshot }, play: async ({ canvasElement }) => {
  await expect(await within(canvasElement).findByRole("button", { name: /US dollar.*Earn up to 4\.10% APY/ })).toBeVisible();
  const screen = await openSavings(canvasElement);
  await expect(screen.getByRole("button", { name: "Deposit" })).toBeEnabled();
  await expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
} };
export const PartialHolding: Story = { args: { snapshot: partialHoldingSnapshot }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByLabelText("Cash balance").textContent).toContain("$1,117.00");
  await expect(within(canvas.getByLabelText("Cash balance")).getByText("Some balances are unavailable")).toBeVisible();
  const rupiah = within(canvas.getByRole("region", { name: "Currencies" })).getByText("Rupiah").closest("li")!;
  await expect(within(rupiah).getByRole("img", { name: /Rp\s*1,900,000\.00/ })).toBeVisible();
  await expect(within(rupiah).getByText("Unavailable")).toBeInTheDocument();
} };
export const UnpricedHolding: Story = { args: { snapshot: unpricedHoldingSnapshot }, play: async ({ canvasElement }) => {
  const rupiah = within(within(canvasElement).getByRole("region", { name: "Currencies" })).getByText("Rupiah").closest("li")!;
  await expect(within(rupiah).getByText("1,900,000.00 IDR")).toBeVisible();
  await expect(within(rupiah).queryByText("$117.00")).toBeNull();
} };
export const CashValueUnpricedWithUsdQuote: Story = { args: { snapshot: cashValueUnpricedSnapshot }, play: async ({ canvasElement }) => {
  const rupiah = within(within(canvasElement).getByRole("region", { name: "Currencies" })).getByText("Rupiah").closest("li")!;
  await expect(within(rupiah).getByText("1,900,000.00 IDR")).toBeVisible();
  await expect(within(rupiah).getByText("$117.00")).toBeVisible();
} };
export const HoldingUnavailable: Story = { args: { snapshot: holdingUnavailableSnapshot }, play: async ({ canvasElement }) => {
  const currencies = within(within(canvasElement).getByRole("region", { name: "Currencies" }));
  await expect(currencies.getAllByRole("listitem")).toHaveLength(1);
  await expect(currencies.queryByText("Rupiah")).toBeNull();
  await expect(await within(canvasElement).findByRole("button", { name: /^US dollar/ })).toBeVisible();
} };
export const LocalHoldingUnavailable: Story = { args: { snapshot: localHoldingUnavailableSnapshot }, play: async ({ canvasElement }) => {
  const currencies = within(within(canvasElement).getByRole("region", { name: "Currencies" }));
  const rupiah = currencies.getByText("Rupiah").closest("li")!;
  await expect(currencies.getAllByRole("listitem")).toHaveLength(2);
  await expect(within(rupiah).getByText("IDRX")).toBeVisible();
  await expect(within(rupiah).getByText("Unavailable")).toBeInTheDocument();
} };
export const UsdcUnavailable: Story = { args: { snapshot: usdcUnavailableSnapshot, initialView: "savings" }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const withdraw = await screen.findByRole("button", { name: "Withdraw" });
  await expect(screen.getByRole("button", { name: "Deposit" })).toBeDisabled();
  await waitFor(() => expect(withdraw).toBeEnabled());
  await userEvent.click(withdraw);
  await expect(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Withdraw" })).toBeVisible();
} };
export const PartialSavings: Story = { args: { snapshot: partialSavingsSnapshot }, play: async ({ canvasElement }) => {
  const row = await within(canvasElement).findByRole("button", { name: /US dollar.*\$800\.00.*Partial/ });
  await expect(within(row).getByText("Partial")).toBeVisible();
  const screen = await openSavings(canvasElement);
  const unreadable = vaultRow(screen.getByRole("region", { name: "Your savings" }), "Steakhouse USDC");
  await expect(within(unreadable).getByText("Unavailable")).toBeInTheDocument();
  const hero = screen.getByLabelText("Savings balance");
  await expect(within(hero).getByRole("img", { name: "$800.00" })).toBeVisible();
  await expect(within(hero).getByText("Some savings are unavailable")).toBeVisible();
  await expect(hero.querySelector("[aria-describedby='savings-balance-partial']")).not.toBeNull();
} };
const partialVaultMetadata = { ...metadata, candidates: metadata.candidates.filter((vault) => vault.vaultAddress !== STEAKHOUSE) };
export const SavingsMetadataPartial: Story = { parameters: { msw: { handlers: [http.get("/api/savings/vaults", () => HttpResponse.json(partialVaultMetadata))] } }, play: async ({ canvasElement }) => {
  const screen = await openSavings(canvasElement);
  const orphan = vaultRow(screen.getByRole("region", { name: "Your savings" }), "Steakhouse USDC");
  await expect(await within(orphan).findByText("Rate unavailable")).toBeVisible();
  await expect(within(orphan).getByRole("img", { name: "$83.00" })).toBeVisible();
  const hero = screen.getByLabelText("Savings balance");
  await expect(within(hero).getByText("Rate unavailable")).toBeVisible();
  await expect(within(hero).queryByText(/Earn/)).toBeNull();
  const withdraw = screen.getByRole("button", { name: "Withdraw" });
  await expect(withdraw).toBeEnabled();
  await userEvent.click(withdraw);
  await waitFor(() => expect(withdraw).toHaveAttribute("aria-expanded", "true"));
  const chooser = within(screen.getByRole("region", { name: "Withdraw from" }));
  await expect(chooser.getAllByRole("button", { name: /^(Gauntlet USDC Prime|Steakhouse USDC)/ })).toHaveLength(2);
  await userEvent.click(chooser.getByRole("button", { name: /^Steakhouse USDC/, description: "Withdraw from Steakhouse USDC" }));
  const body = within(canvasElement.ownerDocument.body);
  const dialog = await body.findByRole("dialog", { name: "Withdraw" });
  await expect(await within(dialog).findByText("$83.00 available")).toBeVisible();
  await userEvent.type(await within(dialog).findByRole("textbox", { name: "Amount" }), "2");
  await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await expect(within(await body.findByRole("dialog", { name: "Confirm" })).getByText("Steakhouse USDC")).toBeVisible();
  await expect(journey.prepared).toEqual([{ endpoint: "savings-withdraw", input: { kind: "withdraw", vaultAddress: STEAKHOUSE, amountBaseUnits: "2000000" } }]);
} };
export const BalancesFailed: Story = { args: { balanceStatus: "failed" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.queryByRole("region", { name: "Currencies" })).toBeNull();
  await expect(canvas.queryByRole("region", { name: "Savings" })).toBeNull();
  await expect(canvas.getByLabelText("Balance unavailable").textContent).toContain("Couldn't load your balance. Check your connection.");
  await expect(canvas.getByLabelText("Balance unavailable").querySelector("[data-cash-rate]")).toBeNull();
  const retry = canvas.getByRole("button", { name: "Try again" });
  await userEvent.click(retry);
  await expect(retryBalances).toHaveBeenCalledTimes(1);
} };
export const SavingsDetailBalancesFailed: Story = { args: { balanceStatus: "failed", initialView: "savings" }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const hero = screen.getByLabelText("Balance unavailable");
  await expect(hero.textContent).not.toContain("$0.00");
  await expect(within(hero).getByText("Unavailable")).toBeInTheDocument();
  await expect(within(hero).getByText("Couldn't load your balance. Check your connection.")).toBeVisible();
  await expect(screen.queryByRole("button", { name: "Deposit" })).toBeNull();
  await expect(screen.queryByRole("region", { name: "More ways to save" })).toBeNull();
  const retry = screen.getByRole("button", { name: "Try again" });
  await expect(retry.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  retryBalances.mockClear();
  await userEvent.click(retry);
  await expect(retryBalances).toHaveBeenCalledTimes(1);
} };
const unreadableSavingsSnapshot = buildBalancesSnapshotFixture({ registry: {
  ...cashRegistry,
  "morpho-re7-usdc": { balance: unavailableBalance, underlyingBalance: unavailableBalance, value: { status: "unavailable" } },
} });
export const SavingsDetailUnreadable: Story = { args: { snapshot: unreadableSavingsSnapshot, initialView: "savings" }, play: async ({ canvasElement }) => {
  const hero = detail(canvasElement).getByLabelText("Savings balance");
  await expect(hero.textContent).not.toContain("$0.00");
  await expect(await within(hero).findByText("Some savings are unavailable")).toBeVisible();
  await expect(within(hero).getByText("Unavailable")).toBeInTheDocument();
} };
export const SavingsDetailStaleRates: Story = { args: { initialView: "savings" }, parameters: { msw: { handlers: [http.get("/api/savings/vaults", () => HttpResponse.json({ ...metadata, stale: true }))] } }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const more = await screen.findByRole("region", { name: "More ways to save" });
  await expect(within(more).queryByText("Rate unavailable")).toBeNull();
  await expect(within(screen.getByRole("region", { name: "Your savings" })).queryByText("Rate unavailable")).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Deposit" })).toBeEnabled());
} };
const failedVaultHandler = http.get("/api/savings/vaults", () => new HttpResponse(null, { status: 500 }));
export const VaultRatesFailed: Story = { parameters: { msw: { handlers: [failedVaultHandler] } }, play: async ({ canvasElement }) => {
  const row = await within(canvasElement).findByRole("button", { name: /US dollar.*Rate unavailable.*\$883\.00/ });
  await expect(row).toBeVisible();
  await expect(within(canvasElement).getByLabelText("Cash balance").querySelector("[data-cash-rate]")).toBeNull();
} };
export const EmptyRatesFailed: Story = { args: { snapshot: emptySnapshot }, parameters: { msw: { handlers: [failedVaultHandler] } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const row = await canvas.findByRole("button", { name: /US dollar.*Rate unavailable/ });
  await expect(row).toBeVisible();
  await expect(canvas.queryByRole("region", { name: "Currencies" })).toBeNull();
  await expect(canvas.getByRole("region", { name: "Savings" })).toBeVisible();
  await userEvent.click(row);
  const screen = detail(canvasElement);
  await expect(await screen.findByText("Savings rates unavailable")).toBeVisible();
  await expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
} };
let recoveryRequests = 0;
export const Recovery: Story = { beforeEach() { recoveryRequests = 0; }, parameters: { msw: { handlers: [http.get("/api/savings/vaults", () => ++recoveryRequests === 1 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(metadata))] } }, play: async ({ canvasElement }) => {
  const screen = await openSavings(canvasElement);
  await screen.findByText("Savings rates unavailable");
  const withdraw = screen.getByRole("button", { name: "Withdraw" });
  await expect(withdraw).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await expect(await screen.findByText("More ways to save")).toBeVisible();
  await expect(withdraw).toBeEnabled();
  await expect(recoveryRequests).toBe(2);
} };
export const DepositJourney: Story = { play: async ({ canvasElement }) => {
  const screen = await openSavings(canvasElement);
  const body = within(canvasElement.ownerDocument.body);
  const opener = screen.getByRole("button", { name: "Deposit" });
  await userEvent.click(opener);
  const dialog = await body.findByRole("dialog", { name: "Deposit" });
  await userEvent.type(await within(dialog).findByRole("textbox", { name: "Amount" }), "25");
  await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  const confirm = await body.findByRole("dialog", { name: "Confirm" });
  await expect(within(confirm).getByText("Gauntlet USDC Prime")).toBeVisible();
  await expect(journey.prepared).toEqual([{ endpoint: "savings-deposit", input: { kind: "deposit", vaultAddress: GAUNTLET, amountBaseUnits: "25000000" } }]);
  await userEvent.click(within(confirm).getByRole("button", { name: "Deposit $25.00" }));
  await expect(await body.findByRole("heading", { name: "Depositing $25.00 to Save" })).toBeVisible();
  await userEvent.click(body.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
  await expect(journey.executed).toHaveLength(1);
  await waitFor(() => expect(opener).toHaveFocus());
} };
export const WithdrawPending: Story = { args: { pendingExecution: true, initialView: "savings" }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const body = within(canvasElement.ownerDocument.body);
  const withdraw = await screen.findByRole("button", { name: "Withdraw" });
  await waitFor(() => expect(withdraw).toBeEnabled());
  await userEvent.click(withdraw);
  await waitFor(() => expect(withdraw).toHaveAttribute("aria-expanded", "true"));
  await userEvent.click(within(screen.getByRole("region", { name: "Withdraw from" })).getByRole("button", { name: /^Gauntlet USDC Prime/, description: "Withdraw from Gauntlet USDC Prime" }));
  await waitFor(() => expect(withdraw).toHaveAttribute("aria-expanded", "false"));
  const dialog = await body.findByRole("dialog", { name: "Withdraw" }, { timeout: 5000 });
  await userEvent.type(await within(dialog).findByRole("textbox", { name: "Amount" }), "25");
  await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  const confirm = await body.findByRole("dialog", { name: "Confirm" }, { timeout: 5000 });
  const submit = within(confirm).getByRole("button", { name: "Withdraw $25.00" });
  await userEvent.click(submit);
  await expect(submit).toHaveAttribute("aria-busy", "true");
  await expect(body.getByRole("button", { name: "Close withdraw dialog" })).toBeDisabled();
  await expect(journey.executed).toHaveLength(1);
} };
export const ReducedMotion: Story = { args: { reducedMotion: true, ticking: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByLabelText("Cash balance").textContent).toContain("$1,234.00");
  earnings.dispatchEvent(new Event("advance"));
  await expect(canvas.getByLabelText("Cash balance").textContent).toContain("$1,234.00");
  await expect(canvasElement.querySelector("[data-animated='true']")).toBeNull();
} };
export const EarningsTicking: Story = { args: { ticking: true }, play: async ({ canvasElement }) => {
  const hero = within(canvasElement).getByLabelText("Cash balance");
  await expect(hero.textContent).toContain("$1,234.00");
  earnings.dispatchEvent(new Event("advance"));
  await waitFor(() => expect(hero.textContent).toMatch(/\$1,234\.\d{6}/));
  await expect(hero.textContent).not.toContain("$1,234.000000");
} };
export const SavingsDetail: Story = { args: { initialView: "savings" }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  await expect(screen.getByLabelText("Savings balance").textContent).toContain("$883.00");
  await expect(await screen.findByText("Earning 4.08% APY")).toBeVisible();
  await expect(screen.getByRole("button", { name: "Deposit" })).toBeEnabled();
  await expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled();
  const held = within(screen.getByRole("region", { name: "Your savings" }));
  await expect(held.getAllByRole("listitem")).toHaveLength(2);
  await expect(vaultRow(screen.getByRole("region", { name: "Your savings" }), "Gauntlet USDC Prime")).toBeVisible();
  await expect(vaultRow(screen.getByRole("region", { name: "Your savings" }), "Steakhouse USDC")).toBeVisible();
  await expect(within(screen.getByRole("region", { name: "More ways to save" })).getByRole("button", { name: /^Spark USDC Vault/, description: "Deposit to Spark USDC Vault" })).toBeVisible();
  await assertButtonHeights(canvasElement, canvasElement.getBoundingClientRect().width >= 800);
} };
export const SavingsDetailDesktop: Story = { args: { initialView: "savings" }, parameters: { viewport: { defaultViewport: "desktop" } }, play: SavingsDetail.play };
export const SavingsDetailWithdrawChooser: Story = { args: { initialView: "savings" }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const withdraw = await screen.findByRole("button", { name: "Withdraw" });
  await waitFor(() => expect(withdraw).toBeEnabled());
  const savings = screen.getByRole("region", { name: "Your savings" });
  const rowHeight = vaultRow(savings, "Gauntlet USDC Prime").getBoundingClientRect().height;
  await userEvent.click(withdraw);
  await expect(withdraw).toHaveAttribute("aria-expanded", "true");
  const card = screen.getByRole("region", { name: "Withdraw from" });
  await expect(vaultRow(card, "Gauntlet USDC Prime").getBoundingClientRect().height).toBe(rowHeight);
  await expect(withdraw).toHaveAttribute("aria-controls", card.id);
  const chooser = within(card);
  await expect(chooser.getByRole("heading", { name: "Withdraw from" })).toHaveAttribute("id", "your-savings-heading");
  await expect(chooser.getAllByRole("listitem")).toHaveLength(2);
  await expect(screen.getAllByText("Gauntlet USDC Prime")).toHaveLength(1);
  await expect(screen.getAllByText("Steakhouse USDC")).toHaveLength(1);
  await assertButtonHeights(canvasElement, canvasElement.getBoundingClientRect().width >= 800);
  await expect(within(chooser.getByRole("button", { name: /^Gauntlet USDC Prime/, description: "Withdraw from Gauntlet USDC Prime" })).getByRole("img", { name: "$800.00" })).toBeVisible();
  await userEvent.click(withdraw);
  await expect(withdraw).toHaveAttribute("aria-expanded", "false");
  await expect(screen.getByRole("region", { name: "Your savings" })).toBe(card);
  await expect(chooser.queryByRole("button", { name: /^Gauntlet USDC Prime/ })).toBeNull();
  await expect(chooser.queryByRole("button", { name: /^Steakhouse USDC/ })).toBeNull();
  await userEvent.click(withdraw);
  await userEvent.keyboard("{Escape}");
  await expect(withdraw).toHaveAttribute("aria-expanded", "false");
  await expect(withdraw).toHaveFocus();
  await expect(screen.getByRole("region", { name: "Your savings" })).toBe(card);
  await expect(chooser.queryByRole("button", { name: /^Gauntlet USDC Prime/ })).toBeNull();
  await expect(chooser.queryByRole("button", { name: /^Steakhouse USDC/ })).toBeNull();
  await userEvent.click(withdraw);
  await userEvent.click(within(screen.getByRole("region", { name: "Withdraw from" })).getByRole("button", { name: /^Steakhouse USDC/, description: "Withdraw from Steakhouse USDC" }));
  await expect(withdraw).toHaveAttribute("aria-expanded", "false");
  const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Withdraw" });
  await expect(await within(dialog).findByText("$83.00 available")).toBeVisible();
  await userEvent.click(within(dialog).getByRole("button", { name: "Close withdraw dialog" }));
  await waitFor(() => expect(withdraw).toHaveFocus());
} };
export const SavingsDetailSingleHeld: Story = { args: { snapshot: savingsOnlySnapshot, initialView: "savings" }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const withdraw = await screen.findByRole("button", { name: "Withdraw" });
  await expect(withdraw).not.toHaveAttribute("aria-expanded");
  await expect(screen.getByRole("region", { name: "Your savings" })).toBeVisible();
  await waitFor(() => expect(withdraw).toBeEnabled());
  await userEvent.click(withdraw);
  await expect(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Withdraw" })).toBeVisible();
} };
export const SavingsDetailNotHeld: Story = { args: { snapshot: cashOnlySnapshot, initialView: "savings" }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const deposit = screen.getByRole("button", { name: "Deposit" });
  await waitFor(() => expect(deposit).toBeEnabled());
  await expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  await expect(screen.queryByRole("region", { name: "Your savings" })).toBeNull();
  const hero = screen.getByLabelText("Savings balance");
  await expect(hero.textContent).toContain("$0.00");
  await expect(within(hero).getByText("Earn up to 4.10% APY")).toBeVisible();
  await expect(screen.getByRole("region", { name: "More ways to save" })).toBeVisible();
} };
export const SavingsDetailRatesFailed: Story = { args: { initialView: "savings" }, parameters: { msw: { handlers: [failedVaultHandler] } }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const held = within(await screen.findByRole("region", { name: "Your savings" }));
  await expect(await held.findByText("Savings rates unavailable")).toBeVisible();
  await expect(held.getByText("Check your connection.")).toBeVisible();
  await expect(screen.queryByText(/Earning .* APY/)).toBeNull();
  await expect(screen.getByRole("button", { name: "Deposit" })).toBeDisabled();
  const withdraw = screen.getByRole("button", { name: "Withdraw" });
  await expect(withdraw).toBeEnabled();
  await expect(withdraw.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await expect(screen.queryByRole("region", { name: "More ways to save" })).toBeNull();
  await expect(within(vaultRow(screen.getByRole("region", { name: "Your savings" }), "Gauntlet USDC Prime")).getByText("Rate unavailable")).toBeVisible();
  await expect(held.getByRole("button", { name: "Try again" })).toBeVisible();
  await userEvent.click(withdraw);
  await waitFor(() => expect(withdraw).toHaveAttribute("aria-expanded", "true"));
  const chooser = within(screen.getByRole("region", { name: "Withdraw from" }));
  await expect(chooser.getAllByRole("button", { name: /^(Gauntlet USDC Prime|Steakhouse USDC)/ })).toHaveLength(2);
  await userEvent.click(chooser.getByRole("button", { name: /^Steakhouse USDC/, description: "Withdraw from Steakhouse USDC" }));
  const body = within(canvasElement.ownerDocument.body);
  const dialog = await body.findByRole("dialog", { name: "Withdraw" });
  await userEvent.type(await within(dialog).findByRole("textbox", { name: "Amount" }), "2");
  await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await expect(within(await body.findByRole("dialog", { name: "Confirm" })).getByText("Steakhouse USDC")).toBeVisible();
  await expect(journey.prepared).toEqual([{ endpoint: "savings-withdraw", input: { kind: "withdraw", vaultAddress: STEAKHOUSE, amountBaseUnits: "2000000" } }]);
} };
export const SavingsDetailEmptyRatesFailed: Story = { args: { snapshot: cashOnlySnapshot, initialView: "savings" }, parameters: { msw: { handlers: [failedVaultHandler] } }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const recovery = await screen.findByText("Savings rates unavailable");
  await expect(recovery.closest('[data-slot="card"]')).toBeVisible();
  await expect(screen.queryByRole("region", { name: "Your savings" })).toBeNull();
} };
export const SavingsDetailLoading: Story = { args: { snapshot: null, balanceStatus: "loading", vaultStatus: "loading", initialView: "savings" }, play: async ({ canvasElement }) => {
  const hero = detail(canvasElement).getByLabelText("Savings balance");
  await expect(hero).toHaveAttribute("aria-busy", "true");
  await expect(within(hero).getByText("Updating…")).toBeInTheDocument();
} };
export const SavingsDetailRatesLoading: Story = { args: { initialView: "savings", vaultStatus: "loading" }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const held = screen.getByRole("region", { name: "Your savings" });
  await expect(held).toHaveAttribute("aria-busy", "true");
  for (const [name, amount] of [["Gauntlet USDC Prime", "$800.00"], ["Steakhouse USDC", "$83.00"]]) {
    const row = within(vaultRow(held, name));
    await expect(row.getByRole("img", { name: amount })).toBeVisible();
    await expect(row.getByText("Loading rate")).toBeInTheDocument();
  }
  await expect(within(held).queryByText("Rate unavailable")).toBeNull();
  await expect(screen.getByRole("button", { name: "Deposit" })).toBeDisabled();
} };
export const SavingsDetailDepositToOther: Story = { args: { initialView: "savings" }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  await userEvent.click(await screen.findByRole("button", { name: /^Spark USDC Vault/, description: "Deposit to Spark USDC Vault" }));
  const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Deposit" });
  await userEvent.type(await within(dialog).findByRole("textbox", { name: "Amount" }), "2");
  await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  const confirm = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  await expect(within(confirm).getByText("Spark USDC Vault")).toBeVisible();
  await expect(journey.prepared).toEqual([{ endpoint: "savings-deposit", input: { kind: "deposit", vaultAddress: SPARK, amountBaseUnits: "2000000" } }]);
} };
export const SavingsDetailBackFocus: Story = { args: { initialView: "savings" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("heading", { name: "Savings", level: 1 })).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(savingsRow(canvasElement)).toHaveFocus());
  await expect(canvas.getByRole("heading", { name: "Cash", level: 1 })).toBeVisible();
} };
export const SavingsDetailChoiceReset: Story = { args: { initialView: "savings", snapshotToggle: true }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const withdraw = await screen.findByRole("button", { name: "Withdraw" });
  await waitFor(() => expect(withdraw).toBeEnabled());
  await userEvent.click(withdraw);
  await expect(withdraw).toHaveAttribute("aria-expanded", "true");
  await expect(screen.getByRole("region", { name: "Withdraw from" })).toBeVisible();
  snapshotChanges.dispatchEvent(new Event("unavailable"));
  await waitFor(() => expect(withdraw).not.toHaveAttribute("aria-expanded", "true"));
  await expect(screen.queryByRole("region", { name: "Withdraw from" })).toBeNull();
  await expect(screen.getByRole("region", { name: "Your savings" })).toBeVisible();
  snapshotChanges.dispatchEvent(new Event("funded"));
  await waitFor(() => expect(withdraw).toHaveAttribute("aria-expanded", "false"));
  await expect(screen.getByRole("region", { name: "Your savings" })).toBeVisible();
} };
export const SavingsDetailDepositClosesWhenBalanceUnreadable: Story = { args: { initialView: "savings", snapshotToggle: true }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const body = within(canvasElement.ownerDocument.body);
  const deposit = screen.getByRole("button", { name: "Deposit" });
  await waitFor(() => expect(deposit).toBeEnabled());
  await userEvent.click(deposit);
  await expect(await body.findByRole("dialog", { name: "Deposit" })).toBeVisible();
  snapshotChanges.dispatchEvent(new Event("unavailable"));
  await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
  await expect(deposit).toBeDisabled();
  await waitFor(() => expect(within(canvasElement).getByRole("button", { name: "Back" })).toHaveFocus());
  snapshotChanges.dispatchEvent(new Event("funded"));
  await waitFor(() => expect(deposit).toBeEnabled());
} };
export const SavingsDetailDepositClosesWhenBalancesFail: Story = { args: { initialView: "savings", snapshotToggle: true }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const body = within(canvasElement.ownerDocument.body);
  const deposit = screen.getByRole("button", { name: "Deposit" });
  await waitFor(() => expect(deposit).toBeEnabled());
  await userEvent.click(deposit);
  await expect(await body.findByRole("dialog", { name: "Deposit" })).toBeVisible();
  snapshotChanges.dispatchEvent(new Event("failed"));
  await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
  await expect(screen.getByLabelText("Balance unavailable")).toBeVisible();
  await waitFor(() => expect(within(canvasElement).getByRole("button", { name: "Back" })).toHaveFocus());
  snapshotChanges.dispatchEvent(new Event("funded"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Deposit" })).toBeEnabled());
} };
export const SavingsDetailWithdrawClosesWhenBalancesFail: Story = { args: { snapshot: usdcUnavailableSnapshot, initialView: "savings", snapshotToggle: true }, play: async ({ canvasElement }) => {
  const screen = detail(canvasElement);
  const body = within(canvasElement.ownerDocument.body);
  const withdraw = await screen.findByRole("button", { name: "Withdraw" });
  await waitFor(() => expect(withdraw).toBeEnabled());
  await userEvent.click(withdraw);
  await expect(await body.findByRole("dialog", { name: "Withdraw" })).toBeVisible();
  snapshotChanges.dispatchEvent(new Event("failed"));
  await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
  await expect(screen.getByLabelText("Balance unavailable")).toBeVisible();
  await waitFor(() => expect(within(canvasElement).getByRole("button", { name: "Back" })).toHaveFocus());
} };
