import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useRef, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { BorrowOverview } from "./borrow-overview";
import { summarizeBorrowOverview } from "./borrow-overview-model";
import type { BorrowMarketId } from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot, BorrowOverviewResponse } from "@/shared/borrowing/contract";
import {
  borrowCapacityAssets,
  healthFactorWad,
  liquidationPriceRaw,
  minimumCollateralForHealthFactor,
  policyMaximumDebtAssets,
} from "@/shared/borrowing/math";
import { BORROW_HEALTH_FLOOR_WAD } from "@/shared/borrowing/config";
import { MORPHO_BLUE_ADDRESS, VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { availableBorrowAssets, toSharesDown, toSharesUp } from "@/shared/morpho-markets/math";
import type { MoneyActionAmount, PreparedMoneyAction } from "@/shared/money-actions/types";
import { parseBorrowActionIntent, type BorrowActionIntent } from "@/shared/borrowing/types";
import { borrowOverviewBody, sessionBody } from "@/tests/browser/fixtures/bodies";
import { formatFiatAmount } from "@/shared/formatting";

const borrowStorySession = {
  user: sessionBody.user,
  smartAccount: { address: sessionBody.smartAccount.address as `0x${string}`, chainId: 8453 as const },
  accountProvider: "cdp-embedded" as const,
};
const markets = VERIFIED_MORPHO_MARKETS;
const bps = ["48700000000000000", "50000000000000000", "50800000000000000", "68700000000000000", "51000000000000000"];

function marketAvailableBorrow(state: BorrowMarketSnapshot["state"], borrowShares: bigint, maxDebtAssets: bigint): bigint {
  return availableBorrowAssets({
    positionBorrowShares: borrowShares,
    totalBorrowAssets: BigInt(state.totalBorrowAssetsRaw),
    totalBorrowShares: BigInt(state.totalBorrowSharesRaw),
    maxDebtAssets,
    liquidityAssets: BigInt(state.liquidityAssetsRaw),
  });
}

function withDebt(snapshot: BorrowMarketSnapshot, debt: string, health: string, rate: string): BorrowMarketSnapshot {
  const owed = BigInt(debt);
  const oracle = BigInt(snapshot.state.oraclePriceRaw);
  const lltv = BigInt(snapshot.market.lltvWad);
  const collateral = minimumCollateralForHealthFactor(owed, oracle, lltv, BigInt(health));
  const rawMax = borrowCapacityAssets(collateral, oracle, lltv);
  const policyMax = policyMaximumDebtAssets(rawMax, BORROW_HEALTH_FLOOR_WAD);
  const floorCollateral = minimumCollateralForHealthFactor(owed, oracle, lltv, BORROW_HEALTH_FLOOR_WAD);
  const atLiquidation = minimumCollateralForHealthFactor(owed, oracle, lltv, BigInt("1000000000000000000"));
  const state = {
    ...snapshot.state,
    borrowAprWad: rate,
    liquidityAssetsRaw: "50000000000000",
    totalBorrowAssetsRaw: "50000000000000",
    totalBorrowSharesRaw: "50000000000000",
  };
  return {
    ...snapshot,
    state,
    position: {
      collateralRaw: collateral.toString(),
      borrowSharesRaw: debt,
      debtAssetsRaw: debt,
      rawBorrowCapacityAssetsRaw: (rawMax > owed ? rawMax - owed : BigInt(0)).toString(),
      borrowCapacityAssetsRaw: marketAvailableBorrow(state, owed, policyMax).toString(),
      rawWithdrawableCollateralRaw: (collateral > atLiquidation ? collateral - atLiquidation : BigInt(0)).toString(),
      withdrawableCollateralRaw: (collateral > floorCollateral ? collateral - floorCollateral : BigInt(0)).toString(),
      healthFactorWad: healthFactorWad(rawMax, owed)?.toString() ?? null,
      liquidationPriceRaw: liquidationPriceRaw(owed, collateral, lltv)?.toString() ?? null,
    },
  };
}

function borrowStoryOverview(): BorrowOverviewResponse {
  const base = borrowOverviewBody({ openMarketId: null });
  const opportunities: BorrowOverviewResponse["opportunities"] = base.opportunities.map((entry, index) => {
    if (entry.availability.status !== "available") return entry;
    let snapshot = entry.availability.snapshot;
    if (index === 0) snapshot = withDebt(snapshot, "1250000000", "1900000000000000000", bps[index]!);
    if (index === 2) snapshot = withDebt(snapshot, "420500000", "1400000000000000000", bps[index]!);
    if (index === 3) snapshot = withDebt(snapshot, "80000000", "1200000000000000000", bps[index]!);
    if (index === 1) {
      const collateral = BigInt("1200") * BigInt("10") ** BigInt(snapshot.market.collateralToken.decimals);
      const rawMax = borrowCapacityAssets(collateral, BigInt(snapshot.state.oraclePriceRaw), BigInt(snapshot.market.lltvWad));
      snapshot = {
        ...snapshot,
        position: {
          ...snapshot.position,
          collateralRaw: collateral.toString(),
          borrowSharesRaw: "0",
          debtAssetsRaw: "0",
          healthFactorWad: null,
          liquidationPriceRaw: null,
          borrowCapacityAssetsRaw: marketAvailableBorrow(snapshot.state, BigInt(0), policyMaximumDebtAssets(rawMax, BORROW_HEALTH_FLOOR_WAD)).toString(),
          withdrawableCollateralRaw: collateral.toString(),
        },
      };
    }
    snapshot = {
      ...snapshot,
      state: { ...snapshot.state, borrowAprWad: bps[index]! },
      wallet: {
        ...snapshot.wallet,
        collateralBalanceRaw: index === 4
          ? (BigInt(2500) * BigInt(10) ** BigInt(snapshot.market.collateralToken.decimals)).toString()
          : index === 3
            ? (BigInt(100) * BigInt(10) ** BigInt(snapshot.market.collateralToken.decimals)).toString()
            : "0",
        loanBalanceRaw: "300000000",
      },
    };
    return { ...entry, availability: { ...entry.availability, snapshot } };
  });
  const positions = opportunities.flatMap((entry) => positionForOpportunity(entry) ?? []);
  return { ...base, opportunities, positions };
}

function positionForOpportunity(entry: BorrowOverviewResponse["opportunities"][number]): BorrowOverviewResponse["positions"][number] | null {
  if (entry.availability.status !== "available") return null;
  const { position } = entry.availability.snapshot;
  if (BigInt(position.debtAssetsRaw) === BigInt(0) && BigInt(position.collateralRaw) === BigInt(0)) return null;
  return {
    market: entry.market,
    source: entry.availability.source,
    collateralRaw: position.collateralRaw,
    borrowSharesRaw: position.borrowSharesRaw,
    debtAssetsRaw: position.debtAssetsRaw,
    healthFactorWad: position.healthFactorWad,
  };
}

function replaceSnapshot(
  overview: BorrowOverviewResponse,
  id: BorrowMarketId,
  update: (snapshot: BorrowMarketSnapshot) => BorrowMarketSnapshot,
): BorrowOverviewResponse {
  const opportunities = overview.opportunities.map((entry) => entry.market.id === id && entry.availability.status === "available"
    ? { ...entry, availability: { ...entry.availability, snapshot: update(entry.availability.snapshot) } }
    : entry);
  const updated = opportunities.find((entry) => entry.market.id === id);
  if (!updated || updated.availability.status !== "available") return { ...overview, opportunities };
  const position = positionForOpportunity(updated);
  const positions = overview.positions.filter((entry) => entry.market.id !== id);
  if (position) {
    const existingIndex = overview.positions.findIndex((entry) => entry.market.id === id);
    const nextIndex = existingIndex < 0 ? positions.findIndex((entry) => entry.market.rank > position.market.rank) : existingIndex;
    positions.splice(nextIndex < 0 ? positions.length : nextIndex, 0, position);
  }
  return { ...overview, opportunities, positions };
}

function borrowPostState(snapshot: BorrowMarketSnapshot, input: BorrowActionIntent) {
  const { operation } = input;
  const { loanToken, collateralToken } = snapshot.market;
  const debt = BigInt(snapshot.position.debtAssetsRaw);
  const collateral = BigInt(snapshot.position.collateralRaw);
  const required = (value: string | undefined) => {
    if (value === undefined) throw new Error(`Missing amount for ${operation}`);
    return BigInt(value);
  };
  const amount = (asset: typeof loanToken, value: bigint, direction: MoneyActionAmount["direction"]): MoneyActionAmount => ({
    assetId: asset.id, symbol: asset.symbol, decimals: asset.decimals, amountBaseUnits: value.toString(), direction,
  });
  const amounts: MoneyActionAmount[] = [];
  let postDebt = debt;
  let postCollateral = collateral;
  let loanDelta = BigInt(0);
  let collateralDelta = BigInt(0);
  let title: string;
  switch (operation) {
    case "supply-collateral": {
      const supplied = required(input.amountBaseUnits);
      postCollateral += supplied;
      collateralDelta -= supplied;
      amounts.push(amount(collateralToken, supplied, "spend"));
      title = `Add ${collateralToken.symbol} collateral`;
      break;
    }
    case "borrow":
    case "supply-and-borrow": {
      const borrowed = required(input.amountBaseUnits);
      if (operation === "supply-and-borrow") {
        const supplied = required(input.collateralAmountBaseUnits);
        postCollateral += supplied;
        collateralDelta -= supplied;
        amounts.push(amount(collateralToken, supplied, "spend"));
      }
      postDebt += borrowed;
      loanDelta += borrowed;
      amounts.push(amount(loanToken, borrowed, "receive"));
      title = operation === "borrow" ? `Borrow ${loanToken.symbol}` : `Borrow ${loanToken.symbol} against ${collateralToken.symbol}`;
      break;
    }
    case "repay": {
      const repaid = required(input.amountBaseUnits);
      postDebt -= repaid;
      loanDelta -= repaid;
      amounts.push(amount(loanToken, repaid, "spend"));
      title = `Repay ${loanToken.symbol}`;
      break;
    }
    case "repay-all":
    case "close-position": {
      const maximum = required(input.maximumRepayBaseUnits);
      postDebt = BigInt(0);
      loanDelta -= debt;
      amounts.push({ ...amount(loanToken, debt, "spend"), estimated: true });
      amounts.push({ ...amount(loanToken, maximum, "spend"), maximum: true });
      if (operation === "close-position" && collateral > BigInt(0)) {
        postCollateral = BigInt(0);
        collateralDelta += collateral;
        amounts.push(amount(collateralToken, collateral, "receive"));
      }
      title = operation === "repay-all" ? `Repay all ${loanToken.symbol} debt` : `Close ${collateralToken.symbol} / ${loanToken.symbol} position`;
      break;
    }
    case "withdraw-collateral": {
      const withdrawn = required(input.amountBaseUnits);
      postCollateral -= withdrawn;
      collateralDelta += withdrawn;
      amounts.push(amount(collateralToken, withdrawn, "receive"));
      title = `Withdraw ${collateralToken.symbol} collateral`;
      break;
    }
  }
  return { postDebt, postCollateral, loanDelta, collateralDelta, amounts, title };
}

function applyBorrowPostState(snapshot: BorrowMarketSnapshot, input: BorrowActionIntent): BorrowMarketSnapshot {
  const { postDebt, postCollateral, loanDelta, collateralDelta } = borrowPostState(snapshot, input);
  const debt = BigInt(snapshot.position.debtAssetsRaw);
  const shares = BigInt(snapshot.position.borrowSharesRaw);
  const totalAssets = BigInt(snapshot.state.totalBorrowAssetsRaw);
  const totalShares = BigInt(snapshot.state.totalBorrowSharesRaw);
  const debtChange = postDebt - debt;
  const shareChange = postDebt === BigInt(0) ? -shares
    : debtChange > BigInt(0) ? toSharesUp(debtChange, totalAssets, totalShares)
    : -toSharesDown(-debtChange, totalAssets, totalShares);
  const postShares = shares + shareChange;
  const nonNegative = (value: bigint) => (value > BigInt(0) ? value : BigInt(0)).toString();
  const state = {
    ...snapshot.state,
    totalBorrowAssetsRaw: nonNegative(totalAssets + debtChange),
    totalBorrowSharesRaw: nonNegative(totalShares + shareChange),
    liquidityAssetsRaw: nonNegative(BigInt(snapshot.state.liquidityAssetsRaw) - debtChange),
  };
  const oracle = BigInt(snapshot.state.oraclePriceRaw);
  const lltv = BigInt(snapshot.market.lltvWad);
  const capacity = borrowCapacityAssets(postCollateral, oracle, lltv);
  const maximum = policyMaximumDebtAssets(capacity, BORROW_HEALTH_FLOOR_WAD);
  const floor = postDebt > BigInt(0) ? minimumCollateralForHealthFactor(postDebt, oracle, lltv, BORROW_HEALTH_FLOOR_WAD) : BigInt(0);
  const liquidation = postDebt > BigInt(0) ? minimumCollateralForHealthFactor(postDebt, oracle, lltv, BigInt("1000000000000000000")) : BigInt(0);
  return {
    ...snapshot,
    state,
    wallet: {
      ...snapshot.wallet,
      loanBalanceRaw: (BigInt(snapshot.wallet.loanBalanceRaw) + loanDelta).toString(),
      collateralBalanceRaw: (BigInt(snapshot.wallet.collateralBalanceRaw) + collateralDelta).toString(),
    },
    position: {
      ...snapshot.position,
      debtAssetsRaw: postDebt.toString(),
      borrowSharesRaw: postShares.toString(),
      collateralRaw: postCollateral.toString(),
      rawBorrowCapacityAssetsRaw: (capacity > postDebt ? capacity - postDebt : BigInt(0)).toString(),
      borrowCapacityAssetsRaw: marketAvailableBorrow(state, postShares, maximum).toString(),
      rawWithdrawableCollateralRaw: (postCollateral > liquidation ? postCollateral - liquidation : BigInt(0)).toString(),
      withdrawableCollateralRaw: (postCollateral > floor ? postCollateral - floor : BigInt(0)).toString(),
      healthFactorWad: healthFactorWad(capacity, postDebt)?.toString() ?? null,
      liquidationPriceRaw: liquidationPriceRaw(postDebt, postCollateral, lltv)?.toString() ?? null,
    },
  };
}

export type BorrowStoryScenario = "success" | "pending" | "failure";
function BorrowStorySurface({
  fixture = borrowStoryOverview(),
  status: initialStatus = "ready",
  initialMarketId,
  scenario = "success",
  recovery,
}: {
  fixture?: BorrowOverviewResponse;
  status?: "ready" | "loading" | "error";
  initialMarketId?: BorrowMarketId;
  scenario?: BorrowStoryScenario;
  recovery?: BorrowOverviewResponse;
}) {
  const [overview, setOverview] = useState(fixture);
  const [status, setStatus] = useState(initialStatus);
  const onRetry = recovery ? () => {
    setOverview(recovery);
    setStatus("ready");
  } : undefined;
  const latestParams = useRef<BorrowActionIntent | null>(null);
  const prepareMoneyAction: AccountWalletClient["prepareMoneyAction"] = async (kind, params) => {
    const input = parseBorrowActionIntent(params);
    if (!input) throw new Error("Unexpected Borrow action");
    const market = overview.opportunities.find((entry) => entry.market.id === input.marketId);
    if (!market || market.availability.status !== "available") throw new Error("Market unavailable");
    const snapshot = market.availability.snapshot;
    const { postDebt, postCollateral, amounts, title } = borrowPostState(snapshot, input);
    latestParams.current = input;
    const capacity = borrowCapacityAssets(postCollateral, BigInt(snapshot.state.oraclePriceRaw), BigInt(snapshot.market.lltvWad));
    const action: PreparedMoneyAction = {
      id: "11111111-1111-4111-8111-111111111111",
      owner: {
        subject: borrowStorySession.user.subject,
        address: borrowStorySession.smartAccount.address,
        chainId: 8453,
        accountProvider: "cdp-embedded",
      },
      kind: kind as PreparedMoneyAction["kind"],
      title,
      calls: [{ to: MORPHO_BLUE_ADDRESS, data: "0x1234", value: "0" }],
      amounts,
      warnings: [],
      metadata: {
        product: "borrow",
        operation: input.operation,
        marketId: input.marketId,
        loanAsset: { id: snapshot.market.loanToken.id, symbol: snapshot.market.loanToken.symbol },
        collateralAsset: { id: snapshot.market.collateralToken.id, symbol: snapshot.market.collateralToken.symbol },
        projectedHealthFactorWad: healthFactorWad(capacity, postDebt)?.toString() ?? null,
        projectedLiquidationPriceRaw: liquidationPriceRaw(postDebt, postCollateral, BigInt(snapshot.market.lltvWad))?.toString() ?? null,
        borrowAprWad: snapshot.state.borrowAprWad,
        source: {
          blockNumber: snapshot.source.blockNumber,
          blockHash: snapshot.source.blockHash,
          blockTimestamp: snapshot.source.blockTimestamp,
        },
      },
      createdAt: "2026-09-13T12:00:00.000Z",
      expiresAt: "2030-09-13T12:02:00.000Z",
    };
    return action;
  };
  const executeMoneyAction: AccountWalletClient["executeMoneyAction"] = async (action) => {
    if (scenario === "pending") return new Promise(() => {});
    if (scenario === "failure") throw new Error("Unresolved dispatch");
    if (latestParams.current) {
      const input = latestParams.current;
      setOverview((current) => replaceSnapshot(current, input.marketId, (snapshot) => applyBorrowPostState(snapshot, input)));
    }
    return { id: action.id, status: "submitted" };
  };
  const totalDebtRaw = summarizeBorrowOverview(overview).totalDebtRaw;
  const summaryDisplay = {
    total: formatFiatAmount(BigInt(totalDebtRaw), 6, "USD", { regionId: "US", fractionDigits: 2, minimumFractionDigits: 2 }),
  };
  return (
    <BorrowOverview
      overview={overview}
      borrowSummary={{ kind: "position", status: "complete", value: summaryDisplay.total, rate: null, debts: overview.opportunities.flatMap((entry) => entry.availability.status === "available" && BigInt(entry.availability.snapshot.position.debtAssetsRaw) > BigInt(0)
        ? [{ marketId: entry.market.id, baseUnits: entry.availability.snapshot.position.debtAssetsRaw }] : []) }}
      status={status}
      onRetry={onRetry}
      session={borrowStorySession}
      regionId="US"
      initialMarketId={initialMarketId}
      prepareMoneyAction={prepareMoneyAction}
      executeMoneyAction={executeMoneyAction}
      fetchAccountResource={async (path) => path === "/api/actions/network-fee"
        ? { version: 1, usdcReserveBaseUnits: null }
        : Promise.reject(new Error(`Unexpected request: ${path}`))}
    />
  );
}

const meta = {
  id: "borrowing-borrow-overview",
  title: "Borrowing/Borrow Overview",
  component: BorrowStorySurface,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof BorrowStorySurface>;
export default meta;
type Story = StoryObj<typeof meta>;
const btc = markets[0]!.marketId;
const eth = markets[2]!.marketId;
const doge = markets[3]!.marketId;
const ada = markets[4]!.marketId;
function only(...ids: BorrowMarketId[]): BorrowOverviewResponse {
  const original = borrowStoryOverview();
  const opportunities = original.opportunities.map((entry) => {
    if (entry.availability.status !== "available" || ids.includes(entry.market.id)) return entry;
    const snapshot = entry.availability.snapshot;
    return {
      ...entry,
      availability: {
        ...entry.availability,
        snapshot: {
          ...snapshot,
          position: {
            ...snapshot.position,
            collateralRaw: "0",
            borrowSharesRaw: "0",
            debtAssetsRaw: "0",
            healthFactorWad: null,
            liquidationPriceRaw: null,
          },
          wallet: { ...snapshot.wallet, collateralBalanceRaw: "0" },
        },
      },
    };
  });
  return {
    ...original,
    opportunities,
    positions: original.positions.filter((position) => ids.includes(position.market.id)),
  };
}

function partialOverview(): BorrowOverviewResponse {
  const base = borrowStoryOverview();
  return {
    ...base,
    discovery: {
      ...base.discovery,
      status: "partial",
      reason: "One Borrow market could not be verified.",
      verifiedCount: 4,
    },
    opportunities: base.opportunities.map((entry) => entry.market.id === eth ? {
      market: entry.market,
      availability: {
        status: "unavailable" as const,
        mode: "enabled" as const,
        reason: "Market unavailable",
        source: null,
      },
    } : entry),
  };
}
function unverifiedOverview(): BorrowOverviewResponse {
  const base = borrowOverviewBody({ openMarketId: null });
  return {
    ...base,
    discovery: { ...base.discovery, status: "partial", sourceBlock: null, verifiedCount: 0, reason: "Markets unavailable" },
    opportunities: base.opportunities.map((entry) => ({
      market: entry.market,
      availability: { status: "unavailable", mode: entry.availability.mode, reason: "Market unavailable", source: null },
    })),
  };
}
export const MultipleLoans: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    await expect(screen.getByRole("img", { name: "$1,750.50" })).toBeVisible();
    const loans = within(screen.getByRole("region", { name: "Open loans" }));
    await expect(loans.getByText("Collateral available")).toBeVisible();
    await expect(loans.getByText("No debt")).toBeVisible();
    const assets = within(screen.getByRole("region", { name: "Assets you can borrow against" }));
    await expect(assets.getByText("In wallet · 5.10% APR")).toBeVisible();
    await expect(assets.getByText("Available")).toBeVisible();
  },
};
export const OneLoan: Story = { args: { fixture: only(btc) } };
export const UrgentFirst: Story = { args: { fixture: borrowStoryOverview() } };
export const ReducingOnly: Story = {
  args: {
    fixture: replaceSnapshot(borrowStoryOverview(), btc, (snapshot) => ({
      ...snapshot,
      wallet: {
        ...snapshot.wallet,
        collateralBalanceRaw: (BigInt(1) * BigInt(10) ** BigInt(snapshot.market.collateralToken.decimals)).toString(),
      },
      eligibility: {
        mode: "reducing-only",
        newRisk: false,
        reason: "New borrowing is paused. You can still repay or add collateral.",
      },
    })),
    initialMarketId: btc,
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const dialog = within(await screen.findByRole("dialog", { name: "Bitcoin" }));
    await expect(dialog.getByRole("button", { name: "Add collateral" })).toBeEnabled();
    await expect(within(canvasElement).getByText("Healthy · Paused")).toBeVisible();
  },
};
export const ZeroDebtCollateral: Story = { args: { fixture: only(markets[1]!.marketId) } };
export const NoDebtHeld: Story = {
  args: {
    fixture: replaceSnapshot(only(), ada, (snapshot) => ({
      ...snapshot,
      wallet: {
        ...snapshot.wallet,
        collateralBalanceRaw: (BigInt(2500) * BigInt(10) ** BigInt(snapshot.market.collateralToken.decimals)).toString(),
      },
    })),
  },
};
export const EmptyNoCollateral: Story = { args: { fixture: only() } };
export const Partial: Story = {
  args: { fixture: partialOverview(), recovery: borrowStoryOverview() },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    await expect(screen.getByText("Some loans couldn't be checked")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await expect(screen.queryByText("Some loans couldn't be checked")).not.toBeInTheDocument();
    await expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  },
};
export const Unverified: Story = {
  args: { fixture: unverifiedOverview(), initialMarketId: btc, recovery: borrowStoryOverview() },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    await expect(screen.getByRole("alert")).toHaveTextContent("Borrow is unavailable");
    await expect(screen.getByText("—")).toBeVisible();
    await expect(screen.getByText("Unavailable")).toBeInTheDocument();
    await expect(screen.queryByRole("img", { name: "$0.00" })).not.toBeInTheDocument();
    await expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    await expect(screen.queryByText("0 USDC")).not.toBeInTheDocument();
    await expect(screen.queryByText("No open loans")).not.toBeInTheDocument();
    await expect(screen.queryByText(/APR/)).not.toBeInTheDocument();
    await expect(screen.queryByRole("region", { name: "Assets you can borrow against" })).not.toBeInTheDocument();
    await expect(screen.queryByText("Add a supported asset to your wallet to borrow USDC.")).not.toBeInTheDocument();
    await expect(within(canvasElement.ownerDocument.body).queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
};
export const Unavailable: Story = {
  args: { status: "error", recovery: borrowStoryOverview() },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    await expect(screen.getByRole("alert")).toHaveTextContent("Current loan values could not be verified. No zero values are shown.");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await expect(screen.getByRole("region", { name: "Open loans" })).toBeVisible();
  },
};
export const Loading: Story = { args: { status: "loading" } };
export const LongLabelLargeAmount: Story = {
  args: {
    fixture: replaceSnapshot(borrowStoryOverview(), btc, (snapshot) =>
      withDebt(snapshot, "12345678900000", "1900000000000000000", bps[0]!)),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("img", { name: "$12,346,179.40" })).toBeVisible();
  },
};
export const ManagementSheetOpen: Story = {
  args: { initialMarketId: btc },
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Bitcoin" }));
    const details = dialog.getByRole("button", { name: "Details" });
    await userEvent.click(details);
    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.getByText("Max LTV")).toBeVisible();
  },
};
export const ManagementSheetUrgent: Story = {
  args: { initialMarketId: doge },
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Dogecoin" }));
    await expect(dialog.getByRole("button", { name: "Repay" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Add collateral" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Borrow more" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: /Withdraw collateral/ })).toBeDisabled();
  },
};
export const MarketSheetHeld: Story = { args: { initialMarketId: ada } };
export const ZeroDebtSheet: Story = {
  args: { initialMarketId: markets[1]!.marketId },
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "XRP" }));
    await expect(dialog.getByText("Collateral")).toBeVisible();
    await expect(dialog.queryByRole("term", { name: "Collateral" })).toBeNull();
    await expect(dialog.getByText("No debt")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Withdraw collateral/ })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Add collateral" })).toBeVisible();
  },
};
export const Desktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } } };
export const Narrow320: Story = { parameters: { viewport: { defaultViewport: "smallMobile" } } };
export const ReducedMotionReference: Story = { args: { initialMarketId: btc } };
export const Text200Percent: Story = {
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  decorators: [(Story) => <div style={{ zoom: 2 }}><Story /></div>],
};
