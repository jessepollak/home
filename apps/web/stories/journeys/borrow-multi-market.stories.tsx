import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { HttpResponse, http } from "msw";
import { BorrowExperience } from "@/client/borrowing/borrowing-experience";
import { shellContentFrameClassName } from "@/components/shell-layout";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { borrowOverviewBody, sessionBody } from "@/tests/browser/fixtures/bodies";

const session: VerifiedAccountSession = {
  user: sessionBody.user,
  smartAccount: { address: sessionBody.smartAccount.address as `0x${string}`, chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const ethMarket = VERIFIED_MORPHO_MARKETS[2]!;

function BorrowJourneySurface() {
  return (
    <main className={`${shellContentFrameClassName} py-4`}>
      <BorrowExperience
        session={session}
        regionId="US"
        fetchAccountResource={async (path, options) => {
          const response = await fetch(path, { signal: options?.signal });
          if (!response.ok) throw new Error("Borrow market is unavailable.");
          return response.json();
        }}
      />
    </main>
  );
}

const meta = {
  id: "journeys-borrow-multi-market",
  title: "Journeys/Borrow Multi-Market",
  component: BorrowJourneySurface,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof BorrowJourneySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultiMarketOverview: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/borrow", () => HttpResponse.json(borrowOverviewBody()))] },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("heading", { name: "Staked ETH" })).toBeVisible();
    await expect(screen.getAllByTestId("borrow-market-card")).toHaveLength(5);
    for (const name of ["Bitcoin", "XRP", "Dogecoin", "Cardano"]) {
      await expect(screen.getByRole("heading", { name })).toBeVisible();
    }
    const ethCard = screen.getByRole("heading", { name: "Staked ETH" }).closest('[data-testid="borrow-market-card"]');
    if (!ethCard) throw new Error("Staked ETH card did not render");
    await expect(within(ethCard as HTMLElement).getByRole("button", { name: "Repay" })).toBeEnabled();
    await expect(within(ethCard as HTMLElement).getByText("Staked ETH locked")).toBeVisible();
    await expect(within(ethCard as HTMLElement).getByText(/per cbETH/)).toBeVisible();
  },
};

export const UrgentHealthRecovery: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/borrow", () => HttpResponse.json(borrowOverviewBody({ urgentMarketId: ethMarket.marketId })))] },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const heading = await screen.findByRole("heading", { name: "Staked ETH" });
    const card = heading.closest('[data-testid="borrow-market-card"]');
    if (!card) throw new Error("Recovery card did not render");
    const recovery = within(card as HTMLElement);
    await expect(recovery.getByRole("button", { name: "Borrow more" })).toBeDisabled();
    await expect(recovery.getByRole("button", { name: "Repay" })).toBeEnabled();
    await expect(recovery.getByRole("button", { name: "Add collateral" })).toBeEnabled();
    await expect(recovery.getByRole("button", { name: /Withdraw collateral from Staked ETH position/ })).toBeDisabled();
  },
};
