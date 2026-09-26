import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { TradeActionParams, TradeDirection } from "@/shared/trading/contract";
import { TransferExecutionError } from "@/shared/transfers/types";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { TradeMoneyDialog } = await import("./trade-money-dialog");

const wallet = "0x1111111111111111111111111111111111111111" as const;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const btc = "0x2222222222222222222222222222222222222222" as const;
const session: VerifiedAccountSession = {
  user: { subject: "synthetic-trade-owner" }, smartAccount: { address: wallet, chainId: 8453 }, accountProvider: "cdp-embedded",
};
function action(direction: TradeDirection, spend: string, expiresAt = new Date(Date.now() + 110_000).toISOString()): PreparedMoneyAction {
  const buy = direction === "buy";
  const receive = buy ? "100000" : "69000000";
  const source = { id: buy ? "usdc" : "cbbtc", symbol: buy ? "USDC" : "cbBTC", decimals: buy ? 6 : 8, address: buy ? usdc : btc } as const;
  const target = { id: buy ? "cbbtc" : "usdc", symbol: buy ? "cbBTC" : "USDC", decimals: buy ? 8 : 6, address: buy ? btc : usdc } as const;
  return {
    id: `fixture-${direction}-${expiresAt}`, kind: "trade", title: buy ? "Buy Bitcoin" : "Sell Bitcoin",
    owner: { subject: session.user.subject, address: wallet, chainId: 8453, accountProvider: session.accountProvider },
    createdAt: new Date().toISOString(), expiresAt, calls: [], warnings: ["Do not use this warning for review facts"],
    amounts: [
      { assetId: source.id, symbol: source.symbol, decimals: source.decimals, amountBaseUnits: spend, direction: "spend" },
      { assetId: target.id, symbol: target.symbol, decimals: target.decimals, amountBaseUnits: receive, direction: "receive", estimated: true },
    ],
    signing: { signer: "base-account", typedData: {} } as PreparedMoneyAction["signing"],
    metadata: {
      product: "trade", provider: "cdp-swaps", direction, network: { name: "Base", chainId: 8453 },
      fromAsset: source, toAsset: target, fromAmountBaseUnits: spend, expectedToAmountBaseUnits: receive,
      minimumToAmountBaseUnits: buy ? "99000" : "68310000", slippageBps: 100, fees: [],
      approval: "permit2-exact", quoteBlockNumber: "123", quotedAt: new Date().toISOString(),
      permitDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30), executionDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30),
    },
  };
}
function dialog(direction: TradeDirection, options: {
  prepare?: (kind: string, params: TradeActionParams) => Promise<PreparedMoneyAction>;
  execute?: () => Promise<{ id: string; status: "rejected" | "submitted" }>;
  balance?: string;
  fetchAccountResource?: () => Promise<unknown>;
} = {}) {
  const requests: TradeActionParams[] = [];
  const prepare = options.prepare ?? (async (_kind: string, params: TradeActionParams) => action(direction, params.amountBaseUnits));
  let executions = 0;
  const view = render(<TradeMoneyDialog open direction={direction} session={session}
    availableBaseUnits={options.balance ?? (direction === "buy" ? "10000000" : "123456")}
    fetchAccountResource={options.fetchAccountResource ?? (async () => ({ version: 1, usdcReserveBaseUnits: "20000" }))}
    prepareMoneyAction={async (kind, params) => {
      requests.push(params as TradeActionParams);
      return prepare(kind, params as TradeActionParams);
    }}
    executeMoneyAction={async () => {
      executions++;
      return options.execute ? options.execute() : { id: "fixture", status: "rejected" };
    }} onClose={() => undefined} />);
  return { view, requests, executions: () => executions };
}
function key(view: ReturnType<typeof render>, name: string) {
  const matches = view.getAllByRole("button", { name });
  fireEvent.click(matches[matches.length - 1]!);
}
function typeAmount(view: ReturnType<typeof render>, value: string) {
  fireEvent.input(view.getByRole("textbox", { name: "Amount" }), { target: { value } });
}
async function continueTrade(view: ReturnType<typeof render>) {
  await waitFor(() => expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  key(view, "Continue");
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("Bitcoin trade review", () => {
  test("Buy Max spends exact Cash less the network-fee reserve", async () => {
    const { view, requests } = dialog("buy");
    await waitFor(() => expect((view.getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false));
    key(view, "Max");
    await continueTrade(view);
    await waitFor(() => expect(requests).toEqual([{ version: 1, assetId: "cbbtc", direction: "buy", amountBaseUnits: "9980000" }]));
  });
  test("Sell supports exact partial base units and full balance Max", async () => {
    const partial = dialog("sell");
    typeAmount(partial.view, "0.0005");
    await continueTrade(partial.view);
    await waitFor(() => expect(partial.requests[0]?.amountBaseUnits).toBe("50000"));
    cleanup();
    const all = dialog("sell");
    key(all.view, "Max");
    await continueTrade(all.view);
    await waitFor(() => expect(all.requests[0]?.amountBaseUnits).toBe("123456"));
  });
  test("review uses quote metadata for minimum, rate, slippage and network, not warnings", async () => {
    const { view } = dialog("buy");
    typeAmount(view, "1");
    await continueTrade(view);
    await waitFor(() => expect(view.getByText("Minimum received")).toBeTruthy());
    expect(view.getByText("Slippage").parentElement?.textContent).toContain("1%");
    expect(view.getByText("Price").parentElement?.textContent).toContain("1 BTC ≈ $1,000.00");
    expect(view.getByText("Network").parentElement?.textContent).toBe("NetworkBase");
    expect(view.queryByText("Do not use this warning for review facts")).toBeNull();
  });
  test("expired quote prepares a new action instead of executing the stale one", async () => {
    let count = 0;
    const trade = dialog("sell", { prepare: async (_kind, params) => {
      count++;
      return action("sell", params.amountBaseUnits, new Date(Date.now() + (count === 1 ? -1000 : 110_000)).toISOString());
    } });
    key(trade.view, "Max");
    await continueTrade(trade.view);
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Get new quote" })).toBeTruthy());
    key(trade.view, "Get new quote");
    await waitFor(() => expect(trade.requests).toHaveLength(2));
    expect(trade.requests[1]?.amountBaseUnits).toBe("123456");
    expect(trade.executions()).toBe(0);
  });
  test("wallet rejection keeps the same review, and Back retains the amount", async () => {
    const trade = dialog("buy");
    typeAmount(trade.view, "1");
    await continueTrade(trade.view);
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    key(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByText(/wallet request was rejected/)).toBeTruthy());
    expect(trade.view.getByText("Minimum received")).toBeTruthy();
    expect(trade.executions()).toBe(1);
    key(trade.view, "Back");
    expect((trade.view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("wallet rejection followed by expiry gets a fresh quote without executing again", async () => {
    let count = 0;
    const trade = dialog("sell", { prepare: async (_kind, params) => action("sell", params.amountBaseUnits,
      new Date(Date.now() + (++count === 1 ? 1200 : 110_000)).toISOString()) });
    key(trade.view, "Max");
    await continueTrade(trade.view);
    const confirm = await waitFor(() => trade.view.getByRole("button", { name: /Sell .* BTC/ }));
    expect(confirm.getAttribute("data-money-action-id")).toBeTruthy();
    key(trade.view, confirm.textContent!);
    await waitFor(() => expect(trade.view.getByText(/wallet request was rejected/)).toBeTruthy());
    expect(trade.executions()).toBe(1);
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Get new quote" }).hasAttribute("data-money-action-id")).toBe(false), { timeout: 2000 });
    key(trade.view, "Get new quote");
    await waitFor(() => expect(trade.requests).toHaveLength(2));
    expect(trade.requests[1]?.amountBaseUnits).toBe("123456");
    expect(trade.executions()).toBe(1);
  });
  test("signing failure retains Buy and offers a new quote after expiry", async () => {
    const trade = dialog("buy", {
      prepare: async (_kind, params) => action("buy", params.amountBaseUnits, new Date(Date.now() + 1200).toISOString()),
      execute: async () => { throw new TransferExecutionError("not-submitted"); },
    });
    typeAmount(trade.view, "1");
    await continueTrade(trade.view);
    const confirm = await waitFor(() => trade.view.getByRole("button", { name: "Buy $1.00" }));
    expect(confirm.getAttribute("data-money-action-id")).toBeTruthy();
    key(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toBe("Couldn't sign this trade. Try again or get a new quote."));
    expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy();
    expect(trade.view.queryByRole("button", { name: "Retry" })).toBeNull();
    await waitFor(() => {
      const primary = trade.view.getByRole("button", { name: "Get new quote" });
      expect(primary.hasAttribute("data-money-action-id")).toBe(false);
    }, { timeout: 2000 });
    expect(trade.executions()).toBe(1);
  });
  test("an invalid signing request retains review with a new-quote recovery message", async () => {
    const trade = dialog("buy", { execute: async () => { throw new TransferExecutionError("invalid-request"); } });
    typeAmount(trade.view, "1");
    await continueTrade(trade.view);
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    key(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toBe("This quote can't be signed. Get a new quote."));
    expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy();
  });
  test("signing failure does not clear a previous unresolved dispatch", async () => {
    let attempts = 0;
    const trade = dialog("buy", { execute: async () => {
      if (++attempts === 1) throw new Error("synthetic dispatch outcome unknown");
      throw new TransferExecutionError("not-submitted");
    } });
    typeAmount(trade.view, "1");
    await continueTrade(trade.view);
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    key(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Retry" })).toBeTruthy());
    key(trade.view, "Retry");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toBe("Couldn't sign this trade. Try again or get a new quote."));
    expect(trade.view.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(trade.view.queryAllByRole("button", { name: "Back" })).toHaveLength(0);
  });
  test("unresolved dispatch removes both Back affordances and keeps them removed after a later rejection", async () => {
    let attempts = 0;
    const trade = dialog("buy", { execute: async () => {
      if (++attempts === 1) throw new Error("synthetic dispatch outcome unknown");
      return { id: "fixture", status: "rejected" };
    } });
    typeAmount(trade.view, "1");
    await continueTrade(trade.view);
    await waitFor(() => expect(trade.view.getAllByRole("button", { name: "Back" })).toHaveLength(2));
    key(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toBe("We couldn't confirm this trade yet. Retry to record the same trade, or check Activity before trading again."));
    expect(trade.view.queryAllByRole("button", { name: "Back" })).toHaveLength(0);
    expect(trade.view.getByRole("button", { name: "Close trade dialog" })).toBeTruthy();
    key(trade.view, "Retry");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toBe("The wallet request was rejected. Review the quote and try again."));
    expect(trade.view.queryAllByRole("button", { name: "Back" })).toHaveLength(0);
    expect(trade.view.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(trade.view.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(trade.executions()).toBe(2);
  });
  test("unresolved dispatch loses Retry and the money marker once its quote expires", async () => {
    const trade = dialog("buy", {
      prepare: async (_kind, params) => action("buy", params.amountBaseUnits, new Date(Date.now() + 1200).toISOString()),
      execute: async () => { throw new Error("synthetic dispatch outcome unknown"); },
    });
    typeAmount(trade.view, "1");
    await continueTrade(trade.view);
    const confirm = await waitFor(() => trade.view.getByRole("button", { name: "Buy $1.00" }));
    expect(confirm.getAttribute("data-money-action-id")).toBeTruthy();
    key(trade.view, "Buy $1.00");
    const retry = await waitFor(() => trade.view.getByRole("button", { name: "Retry" }));
    expect(retry.getAttribute("data-money-action-id")).toBe(confirm.getAttribute("data-money-action-id"));
    await waitFor(() => {
      const primary = trade.view.getByRole("button", { name: /^Close$/ });
      expect(primary.hasAttribute("data-money-action-id")).toBe(false);
      expect(trade.view.getByRole("alert").textContent).toBe("This quote expired before the outcome was recorded. Check Activity before trading again.");
    }, { timeout: 2000 });
    expect(trade.view.queryAllByRole("button", { name: "Back" })).toHaveLength(0);
    key(trade.view, "Close");
    expect(trade.executions()).toBe(1);
    expect(trade.view.getByRole("button", { name: "Continue" })).toBeTruthy();
  });
  test("a failed network-fee check offers Try again and recovers Buy", async () => {
    let settle: (() => void) | undefined;
    let requests = 0;
    const trade = dialog("buy", { fetchAccountResource: async () => {
      requests++;
      if (requests <= 3) throw new Error("synthetic fee policy failure");
      return new Promise((resolve) => { settle = () => resolve({ version: 1, usdcReserveBaseUnits: "20000" }); });
    } });
    typeAmount(trade.view, "1");
    await waitFor(() => expect(trade.view.getByText("Couldn't check the network fee.")).toBeTruthy());
    expect(trade.view.getAllByText("Network fee unavailable").length).toBeGreaterThan(0);
    expect((trade.view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    const retry = trade.view.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("true"));
    expect(retry.isConnected).toBe(true);
    fireEvent.click(retry);
    settle?.();
    await continueTrade(trade.view);
    await waitFor(() => expect(trade.requests[0]?.amountBaseUnits).toBe("1000000"));
    expect(requests).toBe(4);
  });
  test("liquidity error gives a smaller-amount recovery", async () => {
    const trade = dialog("buy", { prepare: async () => { throw { code: "TRADE_NO_LIQUIDITY" }; } });
    typeAmount(trade.view, "1");
    await continueTrade(trade.view);
    await waitFor(() => expect(trade.view.getByText("No liquidity for this amount. Try a smaller trade.")).toBeTruthy());
  });
});
