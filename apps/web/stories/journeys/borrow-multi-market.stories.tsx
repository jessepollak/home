import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
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
  return <main className={`${shellContentFrameClassName} py-4`}>
    <BorrowExperience session={session} regionId="US"
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
  id: "journeys-borrow-multi-market",
  title: "Journeys/Borrow Multi-Market",
  component: BorrowJourneySurface,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof BorrowJourneySurface>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MultiMarketOverview: Story = {
  parameters: { msw: { handlers: [http.get("/api/borrow", () => HttpResponse.json(borrowOverviewBody()))] } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const loans = within(await screen.findByRole("button", { description: "Manage Staked ETH loan" }).then((row) => row.closest("section")!));
    const assets = within(screen.getByRole("region", { name: "Assets you can borrow against" }));
    await expect(loans.getByRole("button", { description: "Manage Staked ETH loan" })).toBeVisible();
    for (const name of ["Bitcoin", "XRP", "Dogecoin", "Cardano"]) {
      await expect(assets.getByText(name)).toBeVisible();
    }
    await userEvent.click(loans.getByRole("button", { description: "Manage Staked ETH loan" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Staked ETH" }));
    await expect(sheet.getByRole("button", { name: "Repay" })).toBeEnabled();
    await expect(sheet.getByText(/per cbETH/)).toBeVisible();
  },
};

export const UrgentHealthRecovery: Story = {
  parameters: { msw: { handlers: [http.get("/api/borrow", () => HttpResponse.json(borrowOverviewBody({ urgentMarketId: ethMarket.marketId })))] } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const loans = within(await screen.findByRole("button", { description: "Manage Staked ETH loan" }).then((row) => row.closest("section")!));
    await userEvent.click(loans.getByRole("button", { description: "Manage Staked ETH loan" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Staked ETH" }));
    await expect(sheet.getByRole("button", { name: "Borrow more" })).toBeDisabled();
    await expect(sheet.getByRole("button", { name: "Repay" })).toBeEnabled();
    await expect(sheet.getByRole("button", { name: "Add collateral" })).toBeEnabled();
    await expect(sheet.getByRole("button", { name: /Withdraw collateral from Staked ETH position/ })).toBeDisabled();
  },
};
