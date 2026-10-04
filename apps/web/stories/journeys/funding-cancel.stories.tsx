import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { expect, userEvent, within } from "storybook/test";
import { createHomeQueryClient } from "@/client/query/query-client";
import { MoneyModal } from "@/client/money-modal";
import { FundingOrderFlow } from "@/client/funding/order-flow";
import { FUNDING_ORDER_VERSION, type FundingOrderSummary } from "@/shared/funding/contracts/order";
import { FUNDING_ORDER_CANCELLATION_VERSION } from "@/shared/funding/contracts/order-cancellation";
import type { FundingBinding } from "@/shared/funding/contracts/providers";

const binding: FundingBinding = {
  direction: "onramp", providerId: "coinbase", displayName: "Coinbase", region: "US", currency: "USD",
  assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6, quotes: true, customerSetup: null,
  paymentMethods: [{ id: "bank-transfer", label: "Bank transfer" }],
};
const awaiting: FundingOrderSummary = {
  id: "story-funding-cancel", providerId: "coinbase", state: "awaiting-payment", fiatAmount: "25",
  expectedTokenAmountAtomic: "25000000", fees: [], providerStatus: null,
  instructions: { kind: "bank-transfer", rail: "ACH", accountNumber: "123456789", amount: "25", currency: "USD" },
};
const cancelled: FundingOrderSummary = { ...awaiting, state: "abandoned", abandonReason: "owner", instructions: null };
function Journey({ order }: { order: FundingOrderSummary }) {
  const [client] = useState(createHomeQueryClient);
  const [open, setOpen] = useState(true);
  return <QueryClientProvider client={client}>
    <main><h1 className="sr-only">Add money</h1>
      <MoneyModal open={open} labelledBy="funding-story-title" onCancel={() => setOpen(false)} onClose={() => {}}>
        <FundingOrderFlow binding={binding} queryOwnerKey="funding-story-owner" initialOrder={order}
          titleId="funding-story-title" onBack={() => setOpen(false)} onOpenRedirect={() => {}}
          fetchAccountResource={async (path) => path.endsWith("/cancel")
            ? { version: FUNDING_ORDER_CANCELLATION_VERSION, order: cancelled }
            : { version: FUNDING_ORDER_VERSION, order }} />
      </MoneyModal>
    </main>
  </QueryClientProvider>;
}
const meta = {
  id: "funding-cancel", title: "Journeys/Funding cancellation", component: Journey,
  parameters: { viewport: { defaultViewport: "mobile" }, a11y: { test: "error" } },
} satisfies Meta<typeof Journey>;
export default meta;
type Story = StoryObj<typeof meta>;
const status = (order: FundingOrderSummary, title: string): Story => ({
  args: { order },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("heading", { name: title })).toBeVisible();
    if (order.state === "abandoned") await expect(screen.getByRole("button", { name: "Start new deposit" })).toBeVisible();
  },
});
export const AwaitingPayment: Story = {
  args: { order: awaiting },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("button", { name: "View payment instructions" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Cancel deposit" })).toBeVisible();
  },
};
export const CancelInteraction: Story = {
  args: { order: awaiting },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel deposit" }));
    await expect(await screen.findByRole("heading", { name: "Deposit cancelled" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Start new deposit" })).toBeVisible();
  },
};
export const Cancelled = status(cancelled, "Deposit cancelled");
export const TimedOut = status({ ...cancelled, abandonReason: "timed-out" }, "Checkout timed out");
export const PaymentReceived = status({ ...awaiting, state: "settling", instructions: null }, "Payment received");
