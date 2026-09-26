import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { TradeActionParams, TradeDirection } from "@/shared/trading/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { cryptoAssets } from "@/config/invest-assets";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import { TradeActions } from "./trade-actions";
import { TradeMoneyDialog } from "./trade-money-dialog";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const btc = "0x2222222222222222222222222222222222222222" as const;
const session: VerifiedAccountSession = {
  user: { subject: "synthetic-story-owner" }, smartAccount: { address: wallet, chainId: 8453 }, accountProvider: "cdp-embedded",
};

function syntheticAction(params: TradeActionParams, expired = false): PreparedMoneyAction {
  const buy = params.direction === "buy";
  const from = buy
    ? { id: "usdc" as const, symbol: "USDC" as const, decimals: 6 as const, address: usdc }
    : { id: "cbbtc" as const, symbol: "cbBTC" as const, decimals: 8 as const, address: btc };
  const to = buy
    ? { id: "cbbtc" as const, symbol: "cbBTC" as const, decimals: 8 as const, address: btc }
    : { id: "usdc" as const, symbol: "USDC" as const, decimals: 6 as const, address: usdc };
  const expected = buy ? "35000" : "700000";
  const expiresAt = new Date(Date.now() + (expired ? -1000 : 110_000)).toISOString();
  return {
    id: `synthetic-${params.direction}-${expiresAt}`, kind: "trade", title: buy ? "Buy Bitcoin" : "Sell Bitcoin",
    owner: { subject: session.user.subject, address: wallet, chainId: 8453, accountProvider: session.accountProvider },
    createdAt: new Date().toISOString(), expiresAt, calls: [], warnings: [],
    amounts: [
      { assetId: from.id, symbol: from.symbol, decimals: from.decimals, amountBaseUnits: params.amountBaseUnits, direction: "spend" },
      { assetId: to.id, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: expected, direction: "receive", estimated: true },
    ],
    signing: { signer: "cdp-embedded", evmAccount: wallet, typedData: {} } as unknown as PreparedMoneyAction["signing"],
    metadata: {
      product: "trade", provider: "cdp-swaps", direction: params.direction, network: { name: "Base", chainId: 8453 },
      fromAsset: from, toAsset: to, fromAmountBaseUnits: params.amountBaseUnits,
      expectedToAmountBaseUnits: expected, minimumToAmountBaseUnits: buy ? "34650" : "693000",
      slippageBps: 100, fees: [{ kind: "protocol", assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000" }],
      approval: "permit2-exact", quoteBlockNumber: "123", quotedAt: new Date().toISOString(),
      permitDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30), executionDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30),
    },
  };
}

type StoryProps = {
  direction?: TradeDirection;
  view?: "amount" | "review" | "expired" | "error" | "availability";
  availability?: "available" | "provider-unconfigured" | "signer-unsupported" | "zero-balance";
  errorCode?: string;
  networkFee?: "available" | "failed";
};
function TradeStory({ direction = "buy", view = "amount", availability = "available", errorCode, networkFee = "available" }: StoryProps) {
  const [open, setOpen] = useState(true);
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [preparations, setPreparations] = useState(0);
  const snapshot = balancesSnapshot("US");
  const tradeBalance = availability === "zero-balance" ? "0" : "100000";
  const fetchBalances = async () => ({
    ...snapshot, owner: { address: wallet, chainId: 8453 },
    holdings: snapshot.holdings.map((holding) => holding.id === "cbbtc"
      ? { ...holding, balance: { status: "ready" as const, baseUnits: tradeBalance } }
      : holding),
  });
  const fetchAccountResource = async (path: string) => path === "/api/trades"
    ? availability === "available" || availability === "zero-balance"
      ? { version: 1, status: "available" }
      : { version: 1, status: "unavailable", reason: availability }
    : networkFee === "failed" ? Promise.reject(new Error("synthetic network-fee failure")) : { version: 1, usdcReserveBaseUnits: "20000" };
  const prepareMoneyAction = async (_kind: string, input: unknown) => {
    if (errorCode) throw { code: errorCode };
    const result = syntheticAction(input as TradeActionParams, view === "expired" && preparations === 0);
    setPreparations((count) => count + 1);
    return result;
  };
  return <QueryClientProvider client={client}><PresentationRegionProvider regionId="US">
    <main className="mx-auto flex min-h-svh w-full max-w-2xl items-center justify-center p-4">
      {view === "availability" ? <AccountWalletClientProvider client={{
        ...createBlockedAccountWalletClient("provider-unavailable"),
        status: "verified", verification: "server", session, fetchBalances, fetchAccountResource,
      }}><TradeActions asset={cryptoAssets.find((asset) => asset.id === "cbbtc")!} /></AccountWalletClientProvider> : <>
        {!open ? <Button onClick={() => setOpen(true)}>Reopen trade</Button> : null}
        <TradeMoneyDialog open={open} direction={direction} session={session}
          availableBaseUnits={direction === "buy" ? "10000000" : "100000"}
          fetchAccountResource={fetchAccountResource}
          prepareMoneyAction={prepareMoneyAction}
          executeMoneyAction={async (action) => ({ id: action.id, status: "rejected" })}
          onClose={() => setOpen(false)} />
      </>}
    </main>
  </PresentationRegionProvider></QueryClientProvider>;
}

async function enterReview(canvasElement: HTMLElement, direction: TradeDirection, useMax = false) {
  const screen = within(canvasElement.ownerDocument.body);
  if (useMax) await userEvent.click(await screen.findByRole("button", { name: "Max" }));
  else await userEvent.type(await screen.findByRole("textbox", { name: "Amount" }), direction === "buy" ? "1" : "0.0005");
  await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await expect(await screen.findByText("Minimum received")).toBeVisible();
  return screen;
}

const meta = {
  title: "Invest/Bitcoin trade review",
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
export const ProviderUnavailable: Story = {
  args: { view: "availability", availability: "provider-unconfigured" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("Trading isn't available right now.")).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Buy" })).toBeDisabled();
  },
};
export const AccountUnsupported: Story = { args: { view: "availability", availability: "signer-unsupported" } };
export const NothingToSell: Story = { args: { view: "availability", availability: "zero-balance" } };
export const BuyAmount: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("dialog", { name: "Buy Bitcoin" })).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Max" })).toBeEnabled();
  },
};
export const BuyReview: Story = {
  args: { view: "review" },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "buy");
    await expect(await screen.findByText("Slippage")).toBeVisible();
    await expect(await screen.findByRole("button", { name: "Buy $1.00" })).toBeEnabled();
  },
};
export const SellPartialReview: Story = {
  args: { view: "review", direction: "sell" },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "sell");
    await expect(await screen.findByRole("button", { name: "Sell 0.0005 BTC" })).toBeEnabled();
  },
};
export const SellAllReview: Story = {
  args: { view: "review", direction: "sell" },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "sell", true);
    await expect(await screen.findByRole("button", { name: "Sell 0.001 BTC" })).toBeEnabled();
  },
};
export const ExpiredQuote: Story = {
  args: { view: "expired" },
  play: async ({ canvasElement }) => {
    const screen = await enterReview(canvasElement, "buy");
    await expect(await screen.findByRole("button", { name: "Get new quote" })).toBeEnabled();
  },
};
export const NoLiquidity: Story = {
  args: { view: "error", errorCode: "TRADE_NO_LIQUIDITY" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.type(await screen.findByRole("textbox", { name: "Amount" }), "1");
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await expect(await screen.findByText("No liquidity for this amount. Try a smaller trade.")).toBeVisible();
  },
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
