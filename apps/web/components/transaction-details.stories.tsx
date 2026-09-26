import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, type ReactNode } from "react";
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
type Scenario = "received-priced" | "received-unpriced" | "received-long" | "received-zora" | "received-large" | "received-digit" | "received-uint256" | "sent-usdc" | OperationScenario | "operation-pending-unsubmitted";

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
          : scenario === "received-zora" ? received({ tokenSymbol: "ZORA", amountBaseUnits: "1234567890123456789012" })
            : scenario === "received-large" ? received({ tokenSymbol: "DEGEN", amountBaseUnits: "123456789012345678901234567890" })
              : scenario === "received-digit" ? received({ tokenSymbol: "TOKEN1" })
                : scenario === "received-uint256" ? received({ tokenSymbol: "TOKEN1", tokenDecimals: 0,
                  amountBaseUnits: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
                  valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" } })
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

function amountDefinition(canvasElement: HTMLElement): HTMLElement {
  const dialog = dialogFor(canvasElement);
  const amount = within(dialog).getByText("Amount").nextElementSibling;
  if (!(amount instanceof HTMLElement)) throw new Error("Missing amount definition");
  return amount;
}

async function checkHeadlineLayout(canvasElement: HTMLElement, amount: string) {
  const dialog = dialogFor(canvasElement);
  const definition = amountDefinition(canvasElement);
  await expect(definition).toHaveTextContent(amount);
  const number = definition.querySelector('[data-slot="transaction-amount-number"]');
  if (!(number instanceof HTMLElement)) throw new Error("Missing numeric amount");
  await expect(number.getClientRects().length).toBe(1);
  const scroll = number.parentElement;
  if (!(scroll instanceof HTMLElement)) throw new Error("Missing numeric scroll container");
  await expect(scroll.getBoundingClientRect().right).toBeLessThanOrEqual(dialog.getBoundingClientRect().right + 1);
  await expect(scroll.getBoundingClientRect().left).toBeGreaterThanOrEqual(dialog.getBoundingClientRect().left - 1);
  if (!scroll.hasAttribute("tabindex")) {
    await expect(number.getBoundingClientRect().right).toBeLessThanOrEqual(dialog.getBoundingClientRect().right + 1);
  }
  return { number, scroll };
}

function EnlargedText({ children }: { children: ReactNode }) {
  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => { document.documentElement.style.fontSize = previous; };
  }, []);
  return children;
}

async function checkReceived(canvasElement: HTMLElement, amount: string, value: string) {
  const dialog = within(dialogFor(canvasElement));
  await checkHeadlineLayout(canvasElement, amount);
  await expect(dialog.getByText(value)).toBeVisible();
  await expect(dialog.getByText("Confirmed")).toBeVisible();
  await expect(dialog.getByText("Base")).toBeVisible();
  await expect(dialog.queryByText("To", { exact: true })).toBeNull();
  await expect(dialog.queryByText("Block", { exact: true })).toBeNull();
  await expect(dialog.queryByText(/Not priced/)).toBeNull();
}

export const ReceivedPriced: Story = {
  play: async ({ canvasElement }) => {
    await checkReceived(canvasElement, "+5,678.00 TEST", "+$12.34");
    const scroll = amountDefinition(canvasElement).querySelector('[data-slot="transaction-amount-scroll"]');
    await expect(scroll).not.toHaveAttribute("tabindex");
  },
};
export const ReceivedDigitSymbol: Story = {
  args: { scenario: "received-digit" },
  play: async ({ canvasElement }) => {
    await checkHeadlineLayout(canvasElement, "+5,678.00 TOKEN1");
    const definition = amountDefinition(canvasElement);
    await expect(definition.querySelector('[data-slot="transaction-amount-number"]')).toHaveTextContent("+5,678.00");
    await expect(definition.querySelector('[data-slot="transaction-amount-unit"]')).toHaveTextContent("TOKEN1");
  },
};
export const ReceivedPricedDesktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  play: async ({ canvasElement }) => checkReceived(canvasElement, "+5,678.00 TEST", "+$12.34"),
};
export const ReceivedUnpriced: Story = {
  args: { scenario: "received-unpriced" },
  play: async ({ canvasElement }) => checkReceived(canvasElement, "+5,678.00 TEST", "Unknown"),
};
export const ReceivedLongToken: Story = {
  args: { scenario: "received-long" },
  play: async ({ canvasElement }) => {
    const dialog = within(dialogFor(canvasElement));
    await checkHeadlineLayout(canvasElement, "+5,678.00 SUPERLONGTOKENNAMEFORTESTING");
    await expect(dialog.getByText("Base")).toBeVisible();
    await expect(dialog.getByText("Confirmed")).toBeVisible();
    await expect(dialog.queryByText("To", { exact: true })).toBeNull();
    await expect(dialog.queryByText("Block", { exact: true })).toBeNull();
  },
};
export const ReceivedLongFraction: Story = {
  args: { scenario: "received-zora" },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => { await checkHeadlineLayout(canvasElement, "+1,234.56 ZORA"); },
};
export const ReceivedLargeWhole: Story = {
  args: { scenario: "received-large" },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => { await checkHeadlineLayout(canvasElement, "+123,456,789,012.34 DEGEN"); },
};
export const ReceivedLargeWholeEnlargedText: Story = {
  args: { scenario: "received-large" },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  decorators: [(Story) => <EnlargedText><Story /></EnlargedText>],
  play: async ({ canvasElement }) => {
    const { number } = await checkHeadlineLayout(canvasElement, "+123,456,789,012.34 DEGEN");
    const reference = number.cloneNode(true) as HTMLElement;
    reference.style.position = "absolute";
    reference.style.visibility = "hidden";
    reference.style.fontSize = "1.5rem";
    amountDefinition(canvasElement).append(reference);
    try {
      await expect(number.getBoundingClientRect().width).toBeGreaterThanOrEqual(reference.getBoundingClientRect().width - 0.5);
    } finally {
      reference.remove();
    }
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth)
      .toBeLessThanOrEqual(canvasElement.ownerDocument.documentElement.clientWidth);
  },
};
export const ReceivedUint256: Story = {
  args: { scenario: "received-uint256" },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => {
    const { scroll } = await checkHeadlineLayout(canvasElement,
      "+115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457,584,007,913,129,639,935 TOKEN1");
    await expect(scroll).toHaveAttribute("tabindex", "0");
    await expect(scroll).toHaveAccessibleName(
      "+115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457,584,007,913,129,639,935 TOKEN1",
    );
    await expect(amountDefinition(canvasElement).querySelector('[data-slot="transaction-amount-unit"]')).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth)
      .toBeLessThanOrEqual(canvasElement.ownerDocument.documentElement.clientWidth);
  },
};
export const SentUsdc: Story = {
  args: { scenario: "sent-usdc" },
  play: async ({ canvasElement }) => {
    const dialog = within(dialogFor(canvasElement));
    await checkHeadlineLayout(canvasElement, "−25.00 USDC");
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
