import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { HttpResponse, http } from "msw";
import { BorrowExperience } from "@/client/borrowing/borrowing-experience";
import { shellContentFrameClassName } from "@/components/shell-layout";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BORROW_HEALTH_FLOOR_WAD } from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import { borrowCapacityAssets, policyMaximumDebtAssets } from "@/shared/borrowing/math";
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { availableBorrowAssets } from "@/shared/morpho-markets/math";
import { borrowOverviewBody, sessionBody } from "@/tests/browser/fixtures/bodies";

const ethMarket = VERIFIED_MORPHO_MARKETS.at(2);
if (!ethMarket) throw new Error("The Staked ETH Borrow market fixture is missing.");
const ethMarketId = ethMarket.marketId;

const fixtureOverview = borrowOverviewBody({ openMarketId: ethMarketId });

const session: VerifiedAccountSession = {
  user: sessionBody.user,
  smartAccount: { address: fixtureOverview.owner.address, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function reducingOnlyCollateralSnapshot(): BorrowMarketSnapshot {
  const entry = fixtureOverview.opportunities.find((candidate) => candidate.availability.status === "available" && candidate.market.id === ethMarketId);
  if (entry?.availability.status !== "available") throw new Error("Borrow market fixture is unavailable.");
  const snapshot = entry.availability.snapshot;
  const collateral = BigInt(snapshot.position.collateralRaw);
  const zeroDebt = {
    positionBorrowShares: BigInt(0),
    totalBorrowAssets: BigInt(snapshot.state.totalBorrowAssetsRaw),
    totalBorrowShares: BigInt(snapshot.state.totalBorrowSharesRaw),
    liquidityAssets: BigInt(snapshot.state.liquidityAssetsRaw),
  };
  const rawMaxDebt = borrowCapacityAssets(collateral, BigInt(snapshot.state.oraclePriceRaw), BigInt(snapshot.market.lltvWad));
  return {
    ...snapshot,
    eligibility: {
      mode: "reducing-only",
      newRisk: false,
      reason: "New borrowing is paused. You can still repay or add collateral.",
    },
    position: {
      ...snapshot.position,
      borrowSharesRaw: "0",
      debtAssetsRaw: "0",
      healthFactorWad: null,
      liquidationPriceRaw: null,
      rawBorrowCapacityAssetsRaw: availableBorrowAssets({ ...zeroDebt, maxDebtAssets: rawMaxDebt }).toString(),
      borrowCapacityAssetsRaw: availableBorrowAssets({ ...zeroDebt, maxDebtAssets: policyMaximumDebtAssets(rawMaxDebt, BORROW_HEALTH_FLOOR_WAD) }).toString(),
      rawWithdrawableCollateralRaw: collateral.toString(),
      withdrawableCollateralRaw: collateral.toString(),
    },
  };
}

function DirectMarketSurface() {
  return <main className={`${shellContentFrameClassName} py-4`}>
    <BorrowExperience session={session} regionId="US"
      selectedMarketId={ethMarketId}
      onSelectMarket={() => {}}
      fetchAccountResource={async (path, options) => {
        const response = await fetch(path, { signal: options?.signal });
        if (!response.ok) throw new Error("Borrow market is unavailable.");
        return response.json();
      }}
      prepareMoneyAction={async () => { throw new Error("Not exercised"); }}
      executeMoneyAction={async () => { throw new Error("Not exercised"); }}
    />
  </main>;
}

const meta = {
  id: "journeys-borrow-direct-market",
  title: "Journeys/Borrow Direct Market",
  component: DirectMarketSurface,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof DirectMarketSurface>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReducingOnlyCollateralHolder: Story = {
  parameters: { msw: { handlers: [http.get(`/api/borrow/markets/${ethMarketId}`, () => HttpResponse.json(reducingOnlyCollateralSnapshot()))] } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("button", { name: "Withdraw collateral from Staked ETH position" })).toBeEnabled();
    await expect(screen.getByRole("button", { name: "Add collateral" })).toBeEnabled();
    await expect(screen.getByRole("button", { name: "Back to Borrow" })).toBeVisible();
    await expect(screen.queryByRole("button", { name: /^Borrow/ })).toBeNull();
  },
};
