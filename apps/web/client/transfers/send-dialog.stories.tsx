import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import type { PreparedMoneyAction, OperationResult } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { encodeUsdcTransfer } from "@/shared/transfers/transfer-helpers";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";
import { cashoutFixturePrepared, cashoutFixtureProviders } from "@/tests/browser/feature-map/cashout-fixture";
import { SendDialog } from "./send-dialog";

const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const action: PreparedMoneyAction = {
  id: "11111111-1111-4111-8111-111111111111", kind: "send", title: "Send USDC",
  createdAt: "2026-09-23T10:35:00.000Z", expiresAt: "2099-09-23T10:45:00.000Z",
  owner: { subject: "send-story", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
  amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
  calls: [{ to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", data: encodeUsdcTransfer(RECIPIENT, BigInt(1000000)), value: "0" }],
  warnings: [],
};
const meta = {
  id: "transfers-send-dialog",
  title: "Transfers/Send dialog",
  component: SendDialog,
  parameters: { layout: "fullscreen" },
  args: {
    entry: "send", open: true, immediate: true, address: action.owner.address, queryOwnerKey: "send-story", resumeActionId: action.id,
    prepareMoneyAction: async () => action, resumeMoneyAction: async () => action,
    fetchAccountResource: async (url: string): Promise<unknown> => url === "/api/actions" ? { actions: [] } : { version: 1, recipients: [] },
    executeMoneyAction: async (): Promise<OperationResult> => ({ id: action.id, status: "submitted" as const }), onClose: () => {},
  },
} satisfies Meta<typeof SendDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function canvas(documentBody: HTMLElement) {
  return within(documentBody.ownerDocument.body);
}

export const Submitting: Story = {
  args: { executeMoneyAction: () => new Promise(() => {}) },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    const primary = await screen.findByRole("button", { name: "Send $1.00" });
    primary.focus();
    await userEvent.click(primary);
    await expect(primary).toHaveAttribute("aria-busy", "true");
    await expect(primary).toHaveAttribute("aria-disabled", "true");
    await expect(primary).toHaveFocus();
    await expect(screen.queryByText("Waiting for your wallet…")).toBeNull();
  },
};

export const Pending: Story = {
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Send $1.00" }));
    await expect(await screen.findByRole("heading", { name: "$1.00 on its way" })).toBeVisible();
    await expect(screen.getByText("Submitted")).toBeVisible();
    await expect(screen.getByText("Confirming on Base")).toBeVisible();
    await expect(screen.getByRole("button", { name: "View in Activity" })).toBeVisible();
  },
};

export const Ambiguous: Story = {
  args: { executeMoneyAction: async () => { throw new TransferExecutionError("submission-unknown"); } },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Send $1.00" }));
    await expect(await screen.findByRole("heading", { name: "We can't confirm $1.00" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "View in Activity" })).toBeVisible();
    await expect(screen.queryByRole("button", { name: /try again|retry/i })).toBeNull();
  },
};

export const Rejected: Story = {
  args: { executeMoneyAction: async () => ({ id: action.id, status: "rejected" }) },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Send $1.00" }));
    await expect(await screen.findByRole("alert")).toHaveTextContent("The wallet request was rejected. Your reviewed send is still ready to retry.");
    await expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  },
};

const withdrawAction: PreparedMoneyAction = {
  ...action, id: "22222222-2222-4222-8222-222222222222", kind: "cash-out-withdraw", title: "Withdraw cash-out",
  owner: { ...action.owner, subject: "withdraw-story" },
  calls: [{ to: "0x777777779d229cdF3110e9de47943791c26300Ef", data: "0x1234", value: "0" }],
  amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "2000000", direction: "receive" }],
  metadata: {
    product: "cashout", operation: "withdraw", providerId: "peer", providerName: "Peer", environment: "production",
    platform: "cashapp", platformLabel: "Cash App", currency: "USD", depositId: "0xescrow_7", approximateFiatAmount: "0", etaSeconds: null,
    minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" },
    estimateAsOf: "2026-09-23T10:35:00.000Z", escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
  },
};

const depositAction: PreparedMoneyAction = {
  ...action, id: "33333333-3333-4333-8333-333333333333", kind: "cash-out", title: "Cash out with Peer",
  owner: { ...action.owner, subject: "deposit-story" },
  calls: [{ to: "0x777777779d229cdF3110e9de47943791c26300Ef", data: "0x1234", value: "0" }],
  metadata: {
    product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production",
    platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "alice",
    approximateFiatAmount: "1", etaSeconds: 60, minConversionRate: "1",
    intentAmountRange: { min: "1000000", max: "1000000" }, estimateAsOf: "2026-09-23T10:35:00.000Z",
    escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
  },
};

export const DepositReview: Story = {
  args: {
    entry: "cash-out", queryOwnerKey: "deposit-story", resumeActionId: depositAction.id,
    prepareMoneyAction: async () => depositAction, resumeMoneyAction: async () => depositAction,
  },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    const destination = await screen.findByRole("group", { name: "Payout destination" });
    await expect(within(destination).getByRole("button", { name: "Edit Cash App cashtag" })).toBeVisible();
    await expect(within(destination).getByText("alice")).toBeVisible();
    await expect(screen.queryByText("Payout handle")).toBeNull();
    await expect(screen.getByRole("button", { name: "Cash out $1.00" })).toBeVisible();
  },
};

export const WithdrawalPending: Story = {
  args: {
    entry: "cash-out", queryOwnerKey: "withdraw-story", resumeActionId: withdrawAction.id,
    prepareMoneyAction: async () => withdrawAction, resumeMoneyAction: async () => withdrawAction,
    executeMoneyAction: async (): Promise<OperationResult> => ({ id: withdrawAction.id, status: "submitted" as const }),
  },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw $2.00" }));
    await expect(await screen.findByRole("heading", { name: "Returning $2.00 to your account" })).toBeVisible();
    await expect(screen.queryByText(/payout/i)).toBeNull();
    await expect(screen.getByRole("button", { name: "View in Activity" })).toBeVisible();
  },
};

const usdc = getTransferAsset("usdc");
if (!usdc) throw new Error("USDC catalog asset is missing");
const cashoutEntryArgs = {
  entry: "cash-out" as const, resumeActionId: null, availableAssets: [{ ...usdc, balanceBaseUnits: "100000000", balanceLabel: "$100.00" }],
  prepareMoneyAction: async () => cashoutFixturePrepared,
  fetchAccountResource: async (url: string) => url.startsWith("/api/funding/providers") ? cashoutFixtureProviders
    : url === "/api/actions/network-fee" ? { version: 1, usdcReserveBaseUnits: null } : { version: 1, recipients: [] },
};

export const CashOutLoading: Story = {
  args: { ...cashoutEntryArgs, fetchAccountResource: (url: string) => url.startsWith("/api/funding/providers") ? new Promise<unknown>(() => {}) : cashoutEntryArgs.fetchAccountResource(url) },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await expect(await screen.findByText("Checking cash-out options…")).toBeVisible();
    await expect(screen.queryByText("Cash out is unavailable right now.")).toBeNull();
    await expect(screen.queryByRole("textbox", { name: "To" })).toBeNull();
  },
};

export const CashOutProviderError: Story = {
  args: { ...cashoutEntryArgs, fetchAccountResource: async (url: string) => {
    if (url.startsWith("/api/funding/providers")) throw new Error("Provider unavailable");
    return cashoutEntryArgs.fetchAccountResource(url);
  } },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await expect(await screen.findByText("Cash out is unavailable right now.")).toBeVisible();
    await expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  },
};

const unsupportedArgs = {
  ...cashoutEntryArgs, regionId: "BR" as const,
  fetchAccountResource: async (url: string) => url.startsWith("/api/funding/providers")
    ? { version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [] } : cashoutEntryArgs.fetchAccountResource(url),
};

export const CashOutUnsupported: Story = {
  args: unsupportedArgs,
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await expect(await screen.findByText("Cash out to Brazilian real isn't available yet")).toBeVisible();
    await expect(screen.getByText("You can still send USDC to any wallet.")).toBeVisible();
    await expect(screen.getByRole("button", { name: "Send USDC" })).toBeVisible();
  },
};

export const CashOutUnsupportedWithoutSend: Story = {
  args: { ...unsupportedArgs, sendOffered: false },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await expect(await screen.findByText("Cash out to Brazilian real isn't available yet")).toBeVisible();
    await expect(screen.queryByRole("button", { name: "Send USDC" })).toBeNull();
    await expect(screen.queryByText("You can still send USDC to any wallet.")).toBeNull();
  },
};

async function showCashoutMethods(canvasElement: HTMLElement) {
  const screen = canvas(canvasElement);
  await userEvent.type(await screen.findByRole("textbox", { name: "Amount" }), "50");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await expect(await screen.findByRole("button", { name: /Cash App.*Peer/ })).toBeVisible();
  await expect(screen.getByRole("button", { name: /Venmo.*Peer/ })).toBeVisible();
  await expect(screen.queryByRole("textbox", { name: "To" })).toBeNull();
  return screen;
}

export const CashOutMethods: Story = {
  args: cashoutEntryArgs,
  play: async ({ canvasElement }) => { await showCashoutMethods(canvasElement); },
};

export const CashOutHandle: Story = {
  args: cashoutEntryArgs,
  play: async ({ canvasElement }) => {
    const screen = await showCashoutMethods(canvasElement);
    await userEvent.click(screen.getByRole("button", { name: /Cash App.*Peer/ }));
    await expect(await screen.findByRole("textbox", { name: "Cash App cashtag" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  },
};

export const CashOutEntryReview: Story = {
  args: cashoutEntryArgs,
  play: async ({ canvasElement }) => {
    const screen = await showCashoutMethods(canvasElement);
    await userEvent.click(screen.getByRole("button", { name: /Cash App.*Peer/ }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Cash App cashtag" }), "$fixture-payee");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await expect(await screen.findByRole("button", { name: "Cash out $50.00" })).toBeVisible();
    await expect(screen.getByRole("group", { name: "Payout destination" })).toHaveTextContent("fixture-payee");
    await expect(screen.queryByRole("textbox", { name: "To" })).toBeNull();
  },
};
