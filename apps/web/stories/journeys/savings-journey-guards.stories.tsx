import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { CashExperience } from "@/client/cash/cash-experience";
import {
  HomeShellRoutingProvider,
  readHomeInboundPanelState,
  type HomeShellRouting,
} from "@/client/home/panel-routing";
import { ProductOfferingProvider } from "@/client/home/product-offering";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { SavingsDialogFixtureProvider } from "@/client/savings/savings-dialog-fixture";
import { shellContentFrameClassName } from "@/components/shell-layout";
import type { ShellFlow } from "@/config/shell-location";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready } from "@/shared/balances/fixtures";
import { resolveProductOffering, type ProductOffering } from "@/shared/operator-settings/products";
import { BASE_USDC_ADDRESS, getVerifiedSaveVault, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";

const TIME = "2026-09-10T12:04:00.000Z";
const fixedNow = () => Date.parse(TIME);
const [GAUNTLET, SPARK] = MORPHO_V1_CANDIDATE_ADDRESSES;
const noop = () => undefined;
const unexpected = async () => { throw new Error("unexpected"); };
const routeCalls: string[] = [];
const SESSION_A: VerifiedAccountSession = {
  user: { subject: "savings-guards-owner-a" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const SESSION_B: VerifiedAccountSession = {
  user: { subject: "savings-guards-owner-b" },
  smartAccount: { address: "0x2222222222222222222222222222222222222222", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function candidate(vaultAddress: MorphoVaultCandidate["vaultAddress"], name: string, netApy: number): MorphoVaultCandidate {
  return {
    version: "v1", vaultAddress, name, symbol: "USDC vault", listed: true, chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    curatorAddress: null, grossApy: netApy + 0.005, netApy, feeRate: 0.1,
    totalAssetsRaw: "1250000000000", liquidityRaw: "850000000000", stateAsOf: TIME, blockNumber: "51026404",
    source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: TIME },
  };
}
const gauntlet = candidate(GAUNTLET, "Gauntlet USDC Prime", 0.041);
const spark = candidate(SPARK, "Spark USDC Vault", 0.0362);
const metadata: MorphoVaultsResult = {
  version: "v1", chainId: 8453, asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
  candidates: [gauntlet, spark],
  source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: TIME },
  stale: false,
};
const cashRegistry = {
  usdc: { balance: ready("250000000"), value: priced("USD", "25000"), cashValue: pricedCash("USD", "25000") },
};
const fundedSnapshotA = buildBalancesSnapshotFixture({ registry: {
  ...cashRegistry,
  "morpho-steakhouse-usdc": { balance: ready("800000000000000000000"), underlyingBalance: ready("800000000"), value: priced("USD", "80000") },
} });
const cashOnlySnapshotB = buildBalancesSnapshotFixture({ registry: cashRegistry });
const defaultOffering = resolveProductOffering({ kind: "deployment" });

type RoutedDepositProps = {
  candidates: MorphoVaultCandidate[];
  vaultModes?: ProductOffering["vaults"];
};

function RoutedDepositSurface({ candidates, vaultModes }: RoutedDepositProps) {
  const [flow, setFlow] = useState<ShellFlow | null>("save-deposit");
  const routing = useMemo<HomeShellRouting>(() => ({
    state: readHomeInboundPanelState(
      { panel: "cash", account: null, shelf: null, asset: null, market: null, cashView: "savings" },
      new URLSearchParams(flow ? { flow } : {}),
    ),
    popRevision: 0, rootRequest: null,
    openPanel: noop, pushRoute: noop, leaveRoute: noop,
    canOpenAssetDetail: () => false, openAssetDetail: () => false,
    setFlow: (next) => { setFlow(next); return true; },
    clearFlow: ({ mode } = {}) => { routeCalls.push(`clear:${mode ?? ""}`); setFlow(null); },
  }), [flow]);
  const offering = useMemo(() => {
    const value = resolveProductOffering({ kind: "deployment" });
    Object.assign(value.vaults, vaultModes);
    return value;
  }, [vaultModes]);
  const metadataValue = useMemo(() => ({ ...metadata, candidates }), [candidates]);
  return (
    <HomeShellRoutingProvider value={routing}>
      <PresentationRegionProvider regionId="US">
        <ProductOfferingProvider value={offering}>
          <SavingsDialogFixtureProvider value={{ motion: "reduced" }}>
            <main className={`${shellContentFrameClassName} py-4`}>
              <CashExperience view="savings" session={SESSION_A} snapshot={fundedSnapshotA} balanceStatus="ready"
                now={fixedNow} fetchVaults={async () => metadataValue} fetchAccountResource={unexpected}
                onOpenSavings={noop} onAddMoney={noop} onRetryBalances={noop}
                prepareMoneyAction={unexpected} executeMoneyAction={unexpected} />
            </main>
          </SavingsDialogFixtureProvider>
        </ProductOfferingProvider>
      </PresentationRegionProvider>
    </HomeShellRoutingProvider>
  );
}

function OwnerChangeSurface() {
  const [active, setActive] = useState(SESSION_A);
  return (
    <PresentationRegionProvider regionId="US">
      <ProductOfferingProvider value={defaultOffering}>
        <SavingsDialogFixtureProvider value={{ motion: "reduced" }}>
          <button type="button" onClick={() => setActive(SESSION_B)}>Switch account</button>
          <main className={`${shellContentFrameClassName} py-4`}>
            <CashExperience view="savings" session={active} snapshot={active === SESSION_A ? fundedSnapshotA : cashOnlySnapshotB}
              balanceStatus="ready" now={fixedNow} fetchVaults={async () => metadata} fetchAccountResource={unexpected}
              onOpenSavings={noop} onAddMoney={noop} onRetryBalances={noop}
              prepareMoneyAction={unexpected} executeMoneyAction={unexpected} />
          </main>
        </SavingsDialogFixtureProvider>
      </ProductOfferingProvider>
    </PresentationRegionProvider>
  );
}

const meta = {
  id: "journeys-savings-journey-guards",
  title: "Journeys/Savings journey guards",
  component: RoutedDepositSurface,
  args: { candidates: [gauntlet] },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" } },
  beforeEach() {
    getHomeQueryClient().clear();
    routeCalls.length = 0;
    const previousState = window.history.state;
    window.history.replaceState({ ...previousState, __cashSavingsFlowPushed: true }, "");
    return () => { window.history.replaceState(previousState, ""); };
  },
} satisfies Meta<typeof RoutedDepositSurface>;
export default meta;
type Story = StoryObj<typeof meta>;

function verifiedSaveVaultId(vaultAddress: MorphoVaultCandidate["vaultAddress"]): string {
  const vault = getVerifiedSaveVault(vaultAddress);
  if (!vault) throw new Error("The fixture vault is not a verified save vault.");
  return vault.id;
}

async function openSavings(canvasElement: HTMLElement) {
  const main = canvasElement.querySelector("main");
  if (!(main instanceof HTMLElement)) throw new Error("The story surface is missing its main element.");
  const screen = within(main);
  const savings = await screen.findByRole("region", { name: "Your savings" });
  await waitForReady(() => expect(savings).not.toHaveAttribute("aria-busy"));
  return screen;
}

async function assertRoutedDepositCleared({ canvasElement }: { canvasElement: HTMLElement }) {
  await openSavings(canvasElement);
  const screen = within(canvasElement.ownerDocument.body);
  await waitForReady(() => expect(routeCalls).toContain("clear:replace"));
  await expect(screen.queryByRole("dialog", { name: "Deposit" })).toBeNull();
  await expect(screen.queryByRole("textbox", { name: "Amount" })).toBeNull();
  await expect(routeCalls.filter((call) => call === "clear:replace")).toHaveLength(1);
}

export const RoutedDepositUnconfiguredVault: Story = {
  args: { vaultModes: { [verifiedSaveVaultId(GAUNTLET)]: "reducing-only" } },
  play: assertRoutedDepositCleared,
};

export const RoutedDepositMissingVault: Story = {
  args: { candidates: [] },
  play: assertRoutedDepositCleared,
};

export const RoutedDepositOpens: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const dialog = await screen.findByRole("dialog", { name: "Deposit" });
    await expect(await within(dialog).findByRole("textbox", { name: "Amount" })).toBeVisible();
    await expect(routeCalls).not.toContain("clear:replace");
  },
};

export const AmountJourneyAccountChange: Story = {
  render: () => <OwnerChangeSurface />,
  play: async ({ canvasElement }) => {
    const switchAccount = within(canvasElement).getByRole("button", { name: "Switch account" });
    const savings = await openSavings(canvasElement);
    const more = await savings.findByRole("region", { name: "More ways to save" });
    await userEvent.click(await within(more).findByRole("button", { description: "Deposit to Spark USDC Vault" }));
    const screen = within(canvasElement.ownerDocument.body);
    await screen.findByRole("textbox", { name: "Amount" });
    await expect(screen.getByRole("dialog", { name: "Deposit" })).toBeVisible();
    await fireEvent.click(switchAccount);
    await waitForReady(() => expect(screen.queryByRole("textbox", { name: "Amount" })).toBeNull());
    await waitForReady(() => expect(screen.queryByRole("dialog", { name: "Deposit" })).toBeNull());
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => { requestAnimationFrame(() => resolve()); });
    });
    await waitForReady(async () => {
      await expect(screen.queryByRole("textbox", { name: "Amount" })).toBeNull();
      await expect(screen.queryByRole("dialog", { name: "Deposit" })).toBeNull();
    });
  },
};

export const ManagementJourneyAccountChange: Story = {
  render: () => <OwnerChangeSurface />,
  play: async ({ canvasElement }) => {
    const switchAccount = within(canvasElement).getByRole("button", { name: "Switch account" });
    const savings = await openSavings(canvasElement);
    const held = within(savings.getByRole("region", { name: "Your savings" }));
    const row = await held.findByRole("button", { description: "Manage Gauntlet USDC Prime" });
    await waitForReady(() => expect(held.queryAllByText("Loading rate")).toHaveLength(0));
    row.focus();
    await fireEvent.click(row);
    const screen = within(canvasElement.ownerDocument.body);
    const tray = await screen.findByRole("dialog", { name: "Gauntlet USDC Prime" });
    await expect(await within(tray).findByText("Saved")).toBeVisible();
    await fireEvent.click(within(tray).getByRole("button", { name: "Deposit more" }));
    await screen.findByRole("textbox", { name: "Amount" });
    await fireEvent.click(switchAccount);
    await waitForReady(() => expect(screen.queryByRole("textbox", { name: "Amount" })).toBeNull());
  },
};
