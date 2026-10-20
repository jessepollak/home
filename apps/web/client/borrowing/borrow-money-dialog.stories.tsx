import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { BorrowMoneyDialog } from "./borrow-money-dialog";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { borrowOverviewBody, sessionBody } from "@/tests/browser/fixtures/bodies";

const session = sessionBody as VerifiedAccountSession;
const availability = borrowOverviewBody().opportunities[2]!.availability;
if (availability.status !== "available") throw new Error("Borrow fixture unavailable");
const snapshot = availability.snapshot;
const action: PreparedMoneyAction = {
  id: "11111111-1111-4111-8111-111111111111",
  owner: { subject: session.user.subject, address: session.smartAccount!.address, chainId: 8453, accountProvider: session.accountProvider },
  kind: "borrow", title: "Borrow USDC", calls: [], warnings: [],
  amounts: [{ assetId: snapshot.market.loanToken.id, symbol: snapshot.market.loanToken.symbol, decimals: snapshot.market.loanToken.decimals, amountBaseUnits: "1000000", direction: "receive" }],
  metadata: { product: "borrow", operation: "borrow", marketId: snapshot.market.id, riskIncreased: true, loanAsset: { id: snapshot.market.loanToken.id, symbol: snapshot.market.loanToken.symbol }, collateralAsset: { id: snapshot.market.collateralToken.id, symbol: snapshot.market.collateralToken.symbol }, projectedHealthFactorWad: null, projectedLiquidationPriceRaw: null, borrowAprWad: "31536000000000000", source: { blockNumber: "100", blockHash: snapshot.source.blockHash, blockTimestamp: "1788897600" } },
  createdAt: "2026-09-23T10:35:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
};

type StoryState = "pending" | "confirmed" | "failed" | "submitting";

function BorrowDialogStory({ state, reviewExpired = false }: { state: StoryState; reviewExpired?: boolean }) {
  const [open, setOpen] = useState(true);
  const preparedAction = reviewExpired ? { ...action, expiresAt: "2026-09-23T10:37:00.000Z" } : action;
  return <BorrowMoneyDialog
    session={session} snapshot={snapshot} operation="borrow" regionId="US" open={open} onClose={() => setOpen(false)}
    prepareMoneyAction={async () => preparedAction}
    executeMoneyAction={async () => state === "submitting" ? new Promise(() => {}) : { id: preparedAction.id, status: "submitted" }}
    fetchAccountResource={async (path) => path === "/api/actions"
      ? { actions: state === "pending" ? [] : [{
          id: preparedAction.id, owner: preparedAction.owner, provider: "cdp-embedded",
          kind: preparedAction.kind, status: state,
          createdAt: preparedAction.createdAt, confirmedAt: preparedAction.createdAt,
          summary: { title: preparedAction.title, amounts: preparedAction.amounts, warnings: preparedAction.warnings, expiresAt: preparedAction.expiresAt, metadata: preparedAction.metadata },
        }] }
      : { version: 1, usdcReserveBaseUnits: null }}
  />;
}

const meta = {
  title: "Borrow/Borrow Dialog Result",
  component: BorrowDialogStory,
  parameters: { viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof BorrowDialogStory>;
export default meta;
type Story = StoryObj<typeof meta>;

async function submit(canvasElement: HTMLElement) {
  const screen = within(canvasElement.ownerDocument.body);
  const dialog = within(await screen.findByRole("dialog", { name: "Borrow" }));
  await userEvent.type(dialog.getByRole("textbox", { name: "Amount" }), "1");
  await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
  await userEvent.click(await dialog.findByRole("button", { name: "Confirm action" }));
  return dialog;
}

export const ExpiredReview: Story = {
  args: { state: "pending", reviewExpired: true },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const dialog = within(await screen.findByRole("dialog", { name: "Borrow" }));
    await userEvent.type(dialog.getByRole("textbox", { name: "Amount" }), "1");
    await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await waitForReady(() => expect(dialog.getByRole("alert")).toHaveTextContent("Borrow review expired"));
    await expect(dialog.getByRole("button", { name: "Confirm action" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Confirm action" })).not.toHaveAttribute("data-money-action-id");
    const back = dialog.getAllByRole("button", { name: "Back" })[0];
    if (!back) throw new Error("Missing Back control");
    await userEvent.click(back);
    await waitForReady(() => expect(dialog.getByRole("button", { name: "Continue" })).toBeVisible());
    await expect(dialog.getByRole("textbox", { name: "Amount" })).toHaveValue("1");
  },
};

export const Pending: Story = {
  args: { state: "pending" },
  play: async ({ canvasElement }) => {
    const dialog = await submit(canvasElement);
    await expect(await dialog.findByText("Borrowing 1 USDC")).toBeVisible();
    await expect(dialog.getByText("Submitted")).toBeVisible();
    await expect(dialog.getByText("Confirming on Base")).toBeVisible();
  },
};

export const Confirmed: Story = {
  args: { state: "confirmed" },
  play: async ({ canvasElement }) => {
    const dialog = await submit(canvasElement);
    await expect(await dialog.findByText("Borrowed 1 USDC")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Done" })).toBeVisible();
  },
};

export const Failed: Story = {
  args: { state: "failed" },
  play: async ({ canvasElement }) => {
    const dialog = await submit(canvasElement);
    await expect(await dialog.findByText("Borrow didn't go through")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
  },
};

export const Submitting: Story = {
  args: { state: "submitting" },
  play: async ({ canvasElement }) => {
    const dialog = await submit(canvasElement);
    await expect(dialog.getByRole("button", { name: "Confirm action" })).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByRole("button", { name: "Close Borrow action" })).toBeDisabled();
  },
};
