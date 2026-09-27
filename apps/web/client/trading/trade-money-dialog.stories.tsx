import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import type { TradeActionParams, TradeDirection } from "@/shared/trading/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { memeAssets } from "@/config/invest-assets";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import { TradeActions } from "./trade-actions";
import { TradeMoneyDialog } from "./trade-money-dialog";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const degen = memeAssets.find((asset) => asset.id === "degen")!;
const token = { assetId: degen.id, address: degen.contractAddress.toLowerCase() as `0x${string}`, symbol: "DEGEN", decimals: 18 };
const session: VerifiedAccountSession = {
  user: { subject: "synthetic-story-owner" }, smartAccount: { address: wallet, chainId: 8453 }, accountProvider: "cdp-embedded",
};

function syntheticAction(params: TradeActionParams, expired = false, tinyPrice = false): PreparedMoneyAction {
  const buy = params.direction === "buy";
  const traded = { id: token.assetId, symbol: token.symbol, decimals: token.decimals, address: token.address };
  const cash = { id: "usdc", symbol: "USDC", decimals: 6, address: usdc };
  const from = buy ? cash : traded;
  const to = buy ? traded : cash;
  const spend = params.amountBaseUnits === "all" ? "100000000000000000000" : params.amountBaseUnits;
  const expected = buy ? tinyPrice ? "2000000000000000000000000" : "35000000000000000000" : "700000";
  const expiresAt = new Date(Date.now() + (expired ? -1000 : 110_000)).toISOString();
  return {
    id: `synthetic-${params.direction}-${expiresAt}`, kind: "trade", title: `${buy ? "Buy" : "Sell"} DEGEN`,
    owner: { subject: session.user.subject, address: wallet, chainId: 8453, accountProvider: session.accountProvider },
    createdAt: new Date().toISOString(), expiresAt, calls: [], warnings: [],
    networkFee: { payment: "usdc", token: usdc, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "20000", decimals: 6 },
    amounts: [
      { assetId: from.id, symbol: from.symbol, decimals: from.decimals, amountBaseUnits: spend, direction: "spend" },
      { assetId: to.id, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: expected, direction: "receive", estimated: true },
    ],
    signing: { signer: "cdp-embedded", evmAccount: wallet, typedData: {} } as unknown as PreparedMoneyAction["signing"],
    metadata: {
      product: "trade", provider: "cdp-swaps", direction: params.direction, network: { name: "Base", chainId: 8453 },
      assetId: token.assetId, assetName: "DEGEN", fromAsset: from, toAsset: to, fromAmountBaseUnits: spend,
      expectedToAmountBaseUnits: expected, minimumToAmountBaseUnits: buy ? tinyPrice ? "1980000000000000000000000" : "34650000000000000000" : "693000",
      slippageBps: 100, fees: [{ kind: "protocol", assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000" }],
      approval: "permit2-exact", quoteBlockNumber: "123", quotedAt: new Date().toISOString(),
      permitDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30), executionDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30),
    },
  };
}

type StoryProps = {
  direction?: TradeDirection;
  view?: "amount" | "review" | "expired" | "error" | "availability";
  availability?: "available" | "blocked" | "provider-unconfigured" | "signer-unsupported" | "token-unreadable" | "chain-unavailable" | "zero-balance";
  errorCode?: string;
  networkFee?: "available" | "failed";
  tinyPrice?: boolean;
};
function TradeStory({ direction = "buy", view = "amount", availability = "available", errorCode, networkFee = "available", tinyPrice = false }: StoryProps) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [preparations, setPreparations] = useState(0);
  const fetchAccountResource = async (path: string) => path.startsWith("/api/trades?")
      ? availability === "available" || availability === "blocked" || availability === "zero-balance"
        ? {
            version: 2, status: "available", token,
            buy: availability === "blocked" ? "blocked" : "available",
            balanceBaseUnits: availability === "zero-balance" ? "0" : "100000000000000000000",
          }
        : { version: 2, status: "unavailable", reason: availability }
      : networkFee === "failed"
        ? Promise.reject(new Error("synthetic network-fee failure"))
        : { version: 1, usdcReserveBaseUnits: "20000" };
  const prepareMoneyAction = async (_kind: string, input: unknown) => {
    if (errorCode) throw { code: errorCode };
    const result = syntheticAction(input as TradeActionParams, view === "expired" && preparations === 0, tinyPrice);
    setPreparations((count) => count + 1);
    return result;
  };
  return <QueryClientProvider client={client}><PresentationRegionProvider regionId="US">
    <main className="mx-auto flex min-h-svh w-full max-w-2xl items-center justify-center p-4">
      {view === "availability" ? <AccountWalletClientProvider client={{
        ...createBlockedAccountWalletClient("provider-unavailable"),
        status: "verified", verification: "server", session,
        fetchBalances: async () => balancesSnapshot("US"), fetchAccountResource,
      }}><TradeActions asset={degen} /></AccountWalletClientProvider> :
        <TradeMoneyDialog open direction={direction} session={session} token={token} assetName="DEGEN"
          availableBaseUnits={direction === "buy" ? "10000000" : "100000000000000000000"}
          assetPrice={direction === "sell" ? { currency: "USD", perUnit: { atoms: "5", scale: 3 } } : null}
          fetchAccountResource={fetchAccountResource}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={async (action) => ({ id: action.id, status: "rejected" })}
          onClose={() => undefined} />}
    </main>
  </PresentationRegionProvider></QueryClientProvider>;
}

async function enterReview(canvasElement: HTMLElement, direction: TradeDirection, useMax = false) {
  const screen = within(canvasElement.ownerDocument.body);
  if (useMax) await userEvent.click(await screen.findByRole("button", { name: "Max" }));
  else await userEvent.type(await screen.findByRole("textbox", { name: "Amount" }), direction === "buy" ? "1" : "0.5");
  await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await expect(await screen.findByText("You get")).toBeVisible();
  return screen;
}
async function expectError(canvasElement: HTMLElement, text: string) {
  const screen = within(canvasElement.ownerDocument.body);
  await userEvent.type(await screen.findByRole("textbox", { name: "Amount" }), "1");
  await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await expect(await screen.findByText(text)).toBeVisible();
}

const meta = {
  title: "Invest/DEGEN trade review",
  component: TradeStory,
  args: { direction: "buy", view: "amount", availability: "available" },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof TradeStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {
  args: { view: "availability" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("button", { name: "Buy" })).toBeEnabled();
    await expect(await screen.findByRole("button", { name: "Sell" })).toBeEnabled();
  },
};
export const BlockedBuy: Story = {
  args: { view: "availability", availability: "blocked" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("button", { name: "Buy" })).toBeDisabled();
    await expect(await screen.findByRole("button", { name: "Sell" })).toBeEnabled();
  },
};
export const ProviderUnavailable: Story = {
  args: { view: "availability", availability: "provider-unconfigured" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("Trading isn't available right now. Try again later.")).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Buy" })).toBeDisabled();
  },
};
export const ChainUnavailable: Story = { args: { view: "availability", availability: "chain-unavailable" } };
export const TokenUnreadable: Story = { args: { view: "availability", availability: "token-unreadable" } };
export const AccountUnsupported: Story = { args: { view: "availability", availability: "signer-unsupported" } };
export const NothingToSell: Story = { args: { view: "availability", availability: "zero-balance" } };
export const BuyAmount: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("dialog", { name: "Buy DEGEN" })).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Max" })).toBeEnabled();
  },
};
export const BuyReview: Story = {
  args: { view: "review" },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "buy");
    await expect(await screen.findByText("Network fee")).toBeVisible();
    await expect(await screen.findByText("DEGEN contract")).toBeVisible();
    await expect(screen.getByRole("button", { name: /^Show full contract 0x/ })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
    await expect(screen.queryByText("Minimum received")).not.toBeInTheDocument();
    await expect(await screen.findByRole("button", { name: "Buy $1.00" })).toBeEnabled();
  },
};
export const ReviewDetailsOpen: Story = {
  args: { view: "review" },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "buy");
    const toggle = await screen.findByRole("button", { name: "Details" });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(screen.getAllByText("DEGEN contract")).toHaveLength(1);
    await expect(await screen.findByText("Minimum received")).toBeVisible();
    await expect(await screen.findByText("Max slippage")).toBeVisible();
  },
};
export const SellAmount: Story = {
  args: { direction: "sell" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("button", { name: /as the primary amount/ })).toBeVisible();
  },
};
export const SubCentPriceReview: Story = {
  args: { view: "review", tinyPrice: true },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "buy");
    await userEvent.click(await screen.findByRole("button", { name: "Details" }));
    await expect(await screen.findByText("1,000 DEGEN ≈ $0.0005")).toBeVisible();
  },
};
export const SellPartialReview: Story = {
  args: { view: "review", direction: "sell" },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "sell");
    await expect(await screen.findByText("DEGEN contract")).toBeVisible();
    await expect(screen.getByRole("button", { name: /^Show full contract 0x/ })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
    await expect(await screen.findByRole("button", { name: "Sell 0.5 DEGEN" })).toBeEnabled();
  },
};
export const SellAllReview: Story = {
  args: { view: "review", direction: "sell" },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "sell", true);
    await expect(await screen.findByRole("button", { name: "Sell 100 DEGEN" })).toBeEnabled();
  },
};
export const ExpiredQuote: Story = {
  args: { view: "expired" },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "buy");
    await expect(await screen.findByRole("button", { name: "Get new quote" })).toBeEnabled();
  },
};
export const RouteUnavailable: Story = {
  args: { view: "error", errorCode: "TRADE_ROUTE_UNAVAILABLE" },
  play: async ({ canvasElement }) => expectError(canvasElement, "No route for this amount. Try a different amount or try again later."),
};
export const BelowMinimum: Story = {
  args: { view: "error", errorCode: "TRADE_BELOW_MINIMUM" },
  play: async ({ canvasElement }) => expectError(canvasElement, "This amount is below the trade minimum. Enter a larger amount."),
};
export const UnreadableQuoteToken: Story = {
  args: { view: "error", errorCode: "TRADE_TOKEN_UNREADABLE" },
  play: async ({ canvasElement }) => expectError(canvasElement, "This token couldn't be read on Base. Try again later."),
};
export const BuyUnavailable: Story = {
  args: { view: "error", errorCode: "TRADE_BUY_UNAVAILABLE" },
  play: async ({ canvasElement }) => expectError(canvasElement, "Buying is unavailable. You can still sell or send."),
};
export const BalanceChanged: Story = {
  args: { view: "error", errorCode: "TRADE_INSUFFICIENT_BALANCE", direction: "sell" },
  play: async ({ canvasElement }) => expectError(canvasElement, "Your token balance changed. Review the amount again."),
};
export const QuoteStale: Story = {
  args: { view: "error", errorCode: "TRADE_QUOTE_STALE" },
  play: async ({ canvasElement }) => expectError(canvasElement, "This quote changed. Get a new quote."),
};
export const TradeOutage: Story = {
  args: { view: "error", errorCode: "TRADE_UNAVAILABLE" },
  play: async ({ canvasElement }) => expectError(canvasElement, "Trading isn't available right now. Try again later."),
};
export const NetworkFeeUnavailable: Story = {
  args: { networkFee: "failed" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("Couldn't check the network fee.", {}, { timeout: 3000 })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    await expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  },
};
