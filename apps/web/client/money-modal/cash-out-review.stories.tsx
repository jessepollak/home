import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { formatUsdStablecoinAmount } from "@/shared/formatting";
import { cashoutQuoteFromLegacy, type CashoutQuote } from "@/shared/funding/cash-out-quote";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { CashOutReview } from "./cash-out-review";

const legacy = cashoutQuoteFromLegacy({ approximateFiatAmount: "50", currency: "USD", etaSeconds: 3600 });
const peer: CashoutQuote = { ...legacy, fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null } };
const spend = { direction: "spend", assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "50000000" } as const;

const action: PreparedMoneyAction = {
  id: "cashout-review-fixture", kind: "cash-out", title: "Cash out", calls: [], warnings: [],
  createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2099-09-01T00:00:00.000Z",
  owner: { subject: "fixture", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
  amounts: [spend],
  networkFee: { payment: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "20000", decimals: 6 },
};

function EnlargedText({ children }: { children: ReactNode }) {
  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => { document.documentElement.style.fontSize = previous; };
  }, []);
  return children;
}

const meta = {
  id: "money-modal-cash-out-review", title: "Money modal/Cash-out review", component: CashOutReview,
  args: { action, amount: "$50.00", quote: peer, providerName: "Peer", platform: "cashapp", platformLabel: "Cash App", canonicalHandle: "alice", onEdit: () => {} },
  render: (args) => <main className="mx-auto grid w-full max-w-md gap-4 px-6 py-4"><CashOutReview {...args} /></main>,
  parameters: { viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof CashOutReview>;
export default meta;
type Story = StoryObj<typeof meta>;

function fact(canvasElement: HTMLElement, label: string): HTMLElement | null {
  const term = within(canvasElement).queryByText(label, { selector: "dt" });
  const value = term?.nextElementSibling;
  return value instanceof HTMLElement ? value : null;
}

async function expectFacts(canvasElement: HTMLElement, expected: Record<string, string | null>) {
  for (const [label, value] of Object.entries(expected)) {
    const cell = fact(canvasElement, label);
    if (value === null) await expect(cell).toBeNull();
    else {
      await expect(cell).toBeVisible();
      await expect(cell).toHaveTextContent(value);
    }
  }
  await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth + 1);
}

async function expectDetails(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /Details/ }));
  await expectFacts(canvasElement, { Provider: "Peer", Network: "Base" });
}

export const UsPeerCashApp: Story = {
  play: async ({ canvasElement }) => {
    await expectFacts(canvasElement, { "You send": "50 USDC", "Peer fee": "None", Rate: null, "You receive": "≈ $50.00 to Cash App", Arrives: "Usually within 1 hour" });
    await expect(fact(canvasElement, "Network fee")).toHaveTextContent("Up to 0.02 USDC");
    await expectDetails(canvasElement);
  },
};

export const BrPresentation: Story = {
  args: {
    action: { ...action, amounts: [{ ...spend, amountBaseUnits: "2500000000" }] },
    amount: formatUsdStablecoinAmount("2500000000", 6, "BR"),
    quote: { ...peer, fees: { ...peer.fees, provider: { amount: "1265.44", currency: "USD" } }, receive: { amount: "1234.56", currency: "USD", approximate: true } },
  },
  decorators: [(Story) => <PresentationRegionProvider regionId="BR"><Story /></PresentationRegionProvider>],
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("$2.500,00", { selector: "bdi", exact: true })).toBeVisible();
    await expectFacts(canvasElement, { "You send": "2.500 USDC", "Peer fee": "$1.265,44", "You receive": "1.234,56" });
    await expect(fact(canvasElement, "Network fee")).toHaveTextContent("Up to 0,02 USDC");
  },
};

export const GbPeerMonzo: Story = {
  args: { amount: "$50.00", quote: { ...peer, receive: { amount: "37.06", currency: "GBP", approximate: true }, rate: { from: "USDC", to: "GBP", value: "0.741234" } }, platform: "monzo", platformLabel: "Monzo" },
  play: async ({ canvasElement }) => expectFacts(canvasElement, { Rate: "1 USDC = 0.7412 GBP", "You receive": "≈ £37.06 to Monzo" }),
};

export const EuroRevolut: Story = {
  args: { amount: "$50.00", quote: { ...peer, receive: { amount: "46", currency: "EUR", approximate: true }, rate: { from: "USDC", to: "EUR", value: "0.92" } }, platform: "revolut", platformLabel: "Revolut" },
  play: async ({ canvasElement }) => expectFacts(canvasElement, { Rate: "1 USDC = 0.92 EUR", "You receive": "to Revolut" }),
};

export const IssuerContractFixturePix: Story = {
  args: {
    amount: "$50.00",
    quote: {
      fees: { provider: { amount: "2.50", currency: "BRL" }, network: { amount: "0.40", currency: "BRL" }, operator: null },
      rate: { from: "USDC", to: "BRL", value: "5.05" },
      receive: { amount: "249.60", currency: "BRL", approximate: false },
      arrival: { source: "declared", kind: "business-days", minDays: 1, maxDays: 2 },
    },
    providerName: "Issuer", platform: "pix", platformLabel: "Pix", canonicalHandle: "alice@example.com",
  },
  play: async ({ canvasElement }) => {
    await expectFacts(canvasElement, { "Issuer fee": "R$", "Provider network fee": "R$", Rate: "1 USDC = 5.05 BRL", "You receive": "to Pix", Arrives: "1–2 business days" });
    await expect(within(canvasElement).queryByText(/estimate/)).toBeNull();
  },
};

export const UnknownArrival: Story = {
  args: { amount: "$50.00", quote: { ...peer, arrival: { source: "unknown" } } },
  play: async ({ canvasElement }) => expectFacts(canvasElement, { Arrives: "Arrival time varies" }),
};

export const LegacyRecord: Story = {
  args: { amount: "$50.00", quote: legacy },
  play: async ({ canvasElement }) => expectFacts(canvasElement, { "Peer fee": "Not quoted", Arrives: "Usually within 1 hour" }),
};

export const QuoteExpired: Story = {
  args: { amount: "$50.00", notice: { tone: "neutral", text: "This quote expired. Get a new quote to continue." } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("This quote expired. Get a new quote to continue.");
  },
};

export const RequoteChanged: Story = {
  args: { amount: "$50.00", notice: { tone: "neutral", text: "The quote changed. Check what you receive before you cash out." }, quote: { ...peer, receive: { amount: "49.00", currency: "USD", approximate: true } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("The quote changed. Check what you receive before you cash out.");
    await expectFacts(canvasElement, { "You receive": "≈ $49.00 to Cash App" });
  },
};

export const SmallMobileLongCopy: Story = {
  args: {
    amount: "$1,250.00",
    providerName: "Auszahlungsdienstleister mit langem Namen",
    platformLabel: "Überweisungsanwendung mit besonders langem Namen",
    canonicalHandle: "ein-sehr-langer-kanonischer-auszahlungsname@beispiel.example",
    quote: { ...peer, receive: { amount: "1250", currency: "USD", approximate: true } },
  },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("group", { name: "Payout destination" })).toBeVisible();
    await expectFacts(canvasElement, { "You receive": "Überweisungsanwendung mit besonders langem Namen" });
  },
};

export const EnlargedTextSize: Story = {
  args: { amount: "$50.00" },
  render: (args) => <EnlargedText><main className="mx-auto grid w-full max-w-md gap-4 px-6 py-4"><CashOutReview {...args} /></main></EnlargedText>,
  play: async ({ canvasElement }) => expectFacts(canvasElement, { "You receive": "≈ $50.00 to Cash App", Arrives: "Usually within 1 hour" }),
};

export const Desktop: Story = {
  args: { amount: "$50.00" },
  parameters: { viewport: { defaultViewport: "desktop" } },
  play: async ({ canvasElement }) => {
    await expectFacts(canvasElement, { "You receive": "≈ $50.00 to Cash App", Arrives: "Usually within 1 hour" });
    await expectDetails(canvasElement);
  },
};
