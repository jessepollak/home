import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { presentActivityTransferDetails } from "@/client/activity/activity-presenter";
import type { ActivityTransfer } from "@/client/activity/types";
import { presentOperationDetails } from "@/client/actions/operation-details";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";
import { TransactionDetailsModal } from "./transaction-details";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"a".repeat(64)}` as `0x${string}`;
const priceUsd = { atoms: "21733", scale: 7 };

function received(overrides: Partial<ActivityTransfer> = {}): ActivityTransfer {
  const amountBaseUnits = overrides.amountBaseUnits ?? "5678000000000000000000";
  return {
    id: "test-transfer", logId: "test-transfer", chainId: 8453,
    assetId: null, tokenAddress: OTHER, tokenSymbol: "TEST", tokenDecimals: 18,
    tokenImageUrl: null, walletAddress: ACCOUNT, fromAddress: OTHER, toAddress: ACCOUNT,
    direction: "incoming", amountBaseUnits, blockNumber: "20", blockHash: HASH,
    transactionHash: HASH, logIndex: "1", blockTimestamp: "2026-09-07T11:05:00.000Z",
    valuation: {
      status: "priced", currency: "USD",
      amount: computeActivityValuationAmount({ amountBaseUnits, tokenDecimals: 18, unitPrice: priceUsd, fxRate: null }),
      method: "historical-close", peg: null,
      close: { provider: "Codex", closedAt: "2026-09-07T11:00:00.000Z", resolutionMinutes: 15, priceUsd },
      fx: null,
    },
    ...overrides,
  };
}

function operation(status: RecentMoneyActionOperation["status"]): RecentMoneyActionOperation {
  return {
    action: {
      id: "11111111-1111-4111-8111-111111111111", kind: "send", title: "Send USDC",
      amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "25000000", direction: "spend" }],
      warnings: [], createdAt: "2026-09-07T11:00:00.000Z", expiresAt: "2026-09-07T11:10:00.000Z",
    },
    status, transactionHash: HASH,
    createdAt: "2026-09-07T11:00:00.000Z", updatedAt: "2026-09-07T11:05:00.000Z",
    ...(status === "pending" ? { submittedAt: "2026-09-07T11:07:00.000Z" } : {}),
  };
}

type OperationScenario = `operation-${RecentMoneyActionOperation["status"]}`;
type Scenario = "received-priced" | "received-unpriced" | "received-long" | "sent-usdc" | OperationScenario | "operation-pending-unsubmitted";

function isOperationScenario(scenario: Scenario): scenario is OperationScenario | "operation-pending-unsubmitted" {
  return scenario.startsWith("operation-");
}

function TransactionDetailsStory({ scenario }: { scenario: Scenario }) {
  const details = isOperationScenario(scenario)
    ? presentOperationDetails(scenario === "operation-pending-unsubmitted"
      ? { ...operation("pending"), transactionHash: undefined, submittedAt: undefined }
      : operation(scenario.slice("operation-".length) as RecentMoneyActionOperation["status"]), { timeZone: "UTC" })
    : presentActivityTransferDetails(
      scenario === "received-unpriced" ? received({ valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" } })
        : scenario === "received-long" ? received({ tokenSymbol: "SUPERLONGTOKENNAMEFORTESTING", amountBaseUnits: "5678000000000000000001" })
          : scenario === "sent-usdc" ? received({ direction: "outgoing", fromAddress: ACCOUNT, toAddress: OTHER,
            assetId: "usdc", tokenSymbol: "USDC", tokenDecimals: 6, amountBaseUnits: "25000000",
            valuation: {
              status: "priced", currency: "USD",
              amount: computeActivityValuationAmount({ amountBaseUnits: "25000000", tokenDecimals: 6, unitPrice: null, fxRate: null }),
              method: "peg", peg: "USD", close: null, fx: null,
            } })
            : received(),
      { timeZone: "UTC" },
    );
  return <TransactionDetailsModal open titleId="story-transaction-title" details={details} onClose={() => {}} />;
}

const meta = {
  id: "ui-transaction-details",
  title: "UI/Transaction Details",
  component: TransactionDetailsStory,
  args: { scenario: "received-priced" },
  parameters: {
    viewport: { defaultViewport: "mobile" },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=282-5882" },
  },
} satisfies Meta<typeof TransactionDetailsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

function dialogFor(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body).getByRole("dialog");
}

async function checkReceived(canvasElement: HTMLElement, amount: string, value: string) {
  const dialog = within(dialogFor(canvasElement));
  await expect(dialog.getByText(amount)).toBeVisible();
  await expect(dialog.getByText(value)).toBeVisible();
  await expect(dialog.getByText("Confirmed")).toBeVisible();
  await expect(dialog.getByText("Base")).toBeVisible();
  await expect(dialog.queryByText("To", { exact: true })).toBeNull();
  await expect(dialog.queryByText("Block", { exact: true })).toBeNull();
  await expect(dialog.queryByText(/Not priced/)).toBeNull();
}

export const ReceivedPriced: Story = {
  play: async ({ canvasElement }) => checkReceived(canvasElement, "+5,678 TEST", "+$12.34"),
};
export const ReceivedPricedDesktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  play: async ({ canvasElement }) => checkReceived(canvasElement, "+5,678 TEST", "+$12.34"),
};
export const ReceivedUnpriced: Story = {
  args: { scenario: "received-unpriced" },
  play: async ({ canvasElement }) => checkReceived(canvasElement, "+5,678 TEST", "Unknown"),
};
export const ReceivedLongToken: Story = {
  args: { scenario: "received-long" },
  play: async ({ canvasElement }) => {
    const dialog = within(dialogFor(canvasElement));
    await expect(dialog.getByText("+5,678.000000000000000001 SUPERLONGTOKENNAMEFORTESTING")).toBeVisible();
    await expect(dialog.getByText("Base")).toBeVisible();
    await expect(dialog.getByText("Confirmed")).toBeVisible();
    await expect(dialog.queryByText("To", { exact: true })).toBeNull();
    await expect(dialog.queryByText("Block", { exact: true })).toBeNull();
  },
};
export const SentUsdc: Story = {
  args: { scenario: "sent-usdc" },
  play: async ({ canvasElement }) => {
    const dialog = within(dialogFor(canvasElement));
    await expect(dialog.getByText("−25 USDC")).toBeVisible();
    await expect(dialog.getByText("−$25.00")).toBeVisible();
    await expect(dialog.getByText("To", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Base")).toBeVisible();
    await expect(dialog.getByText("Confirmed")).toBeVisible();
    await expect(dialog.queryByText(/Not priced/)).toBeNull();
    await expect(dialog.queryByText("Block", { exact: true })).toBeNull();
  },
};

async function checkOperation(canvasElement: HTMLElement, label: string) {
  const dialog = within(dialogFor(canvasElement));
  await expect(dialog.getByText(label)).toBeVisible();
  await expect(dialog.getByText("Base")).toBeVisible();
  await expect(dialog.queryByText("Block", { exact: true })).toBeNull();
  return dialog;
}

async function checkPendingOperation(canvasElement: HTMLElement) {
  const dialog = await checkOperation(canvasElement, "Pending");
  const statusTerm = dialog.getAllByRole("term").find((term) => term.textContent === "Status");
  await expect(statusTerm?.parentElement).toHaveTextContent("Pending");
  const items = dialog.getAllByRole("listitem");
  await expect(items).toHaveLength(2);
  await expect(items[0]).toHaveTextContent("Complete: Submitted");
  await expect(items[0]).toHaveTextContent("11:07");
  await expect(items[1]).toHaveTextContent("In progress: Confirming on Base");
}

async function checkSettledOperation(canvasElement: HTMLElement, label: string) {
  const dialog = await checkOperation(canvasElement, label);
  await expect(dialog.queryByText("Confirming on Base")).toBeNull();
}

export const OperationPending: Story = { args: { scenario: "operation-pending" }, play: async ({ canvasElement }) => checkPendingOperation(canvasElement) };
export const OperationPendingUnsubmitted: Story = {
  args: { scenario: "operation-pending-unsubmitted" },
  play: async ({ canvasElement }) => {
    const dialog = await checkOperation(canvasElement, "Pending");
    await expect(dialog.queryByRole("list")).toBeNull();
    await expect(dialog.queryByText("Confirming on Base")).toBeNull();
  },
};
export const OperationPendingDesktop: Story = {
  args: { scenario: "operation-pending" },
  parameters: { viewport: { defaultViewport: "desktop" } },
  play: async ({ canvasElement }) => checkPendingOperation(canvasElement),
};
export const OperationPendingSmall: Story = {
  args: { scenario: "operation-pending" },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => checkPendingOperation(canvasElement),
};
export const OperationFailed: Story = { args: { scenario: "operation-failed" }, play: async ({ canvasElement }) => checkSettledOperation(canvasElement, "Failed") };
export const OperationUnknown: Story = { args: { scenario: "operation-unknown" }, play: async ({ canvasElement }) => checkSettledOperation(canvasElement, "Outcome unknown") };
export const OperationConfirmed: Story = { args: { scenario: "operation-confirmed" }, play: async ({ canvasElement }) => checkSettledOperation(canvasElement, "Confirmed") };
