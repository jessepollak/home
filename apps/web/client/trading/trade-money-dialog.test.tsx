import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import { TransferExecutionError } from "@/shared/transfers/types";
import type { ExpiryScheduler } from "@/client/actions/expiry";
import type { TradeActionParams, TradeDirection, TradeMoneyActionMetadata, TradeToken } from "@/shared/trading/contract";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { TradeMoneyDialog } = await import("./trade-money-dialog");
const { ExpirySchedulerContext } = await import("@/client/actions/expiry");

const wallet = "0x1111111111111111111111111111111111111111" as const;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const session: VerifiedAccountSession = {
  user: { subject: "synthetic-trade-owner" }, smartAccount: { address: wallet, chainId: 8453 }, accountProvider: "cdp-embedded",
};
const token = (decimals: number): TradeToken => ({
  assetId: "base:0x2222222222222222222222222222222222222222",
  symbol: "DEGEN", decimals, address: "0x2222222222222222222222222222222222222222",
});

function action(direction: TradeDirection, amount: string, traded: TradeToken, expired = false): PreparedMoneyAction {
  const buy = direction === "buy";
  const spend = amount === "all" ? "123000000000000000000" : amount;
  const cash = { id: "usdc", symbol: "USDC", decimals: 6, address: usdc };
  const tradedAsset = { id: traded.assetId, symbol: traded.symbol, decimals: traded.decimals, address: traded.address };
  const from = buy ? cash : tradedAsset;
  const to = buy ? tradedAsset : cash;
  const receive = buy ? (BigInt(10) ** BigInt(traded.decimals)).toString() : "69000000";
  const expiresAt = new Date(Date.now() + (expired ? -1000 : 110_000)).toISOString();
  return {
    id: `fixture-${direction}-${expiresAt}`, kind: "trade", title: `${buy ? "Buy" : "Sell"} DEGEN`,
    owner: { subject: session.user.subject, address: wallet, chainId: 8453, accountProvider: session.accountProvider },
    createdAt: new Date().toISOString(), expiresAt, calls: [], warnings: ["Do not use this warning for review facts"],
    networkFee: { payment: "usdc", token: usdc, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "20000", decimals: 6 },
    amounts: [
      { assetId: from.id, symbol: from.symbol, decimals: from.decimals, amountBaseUnits: spend, direction: "spend" },
      { assetId: to.id, symbol: to.symbol, decimals: to.decimals, amountBaseUnits: receive, direction: "receive", estimated: true },
    ],
    signing: { signer: "base-account", typedData: {} } as PreparedMoneyAction["signing"],
    metadata: {
      product: "trade", provider: "cdp-swaps", direction, network: { name: "Base", chainId: 8453 },
      assetId: traded.assetId, assetName: "DEGEN", fromAsset: from, toAsset: to,
      fromAmountBaseUnits: spend, expectedToAmountBaseUnits: receive,
      minimumToAmountBaseUnits: (BigInt(receive) * BigInt(99) / BigInt(100)).toString(),
      slippageBps: 100, fees: [], approval: "permit2-exact", quoteBlockNumber: "123", quotedAt: new Date().toISOString(),
      permitDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30),
      executionDeadline: String(Math.floor(Date.parse(expiresAt) / 1000) + 30),
    },
  };
}

type DialogOptions = {
  decimals?: number;
  balance?: string;
  error?: string;
  expired?: boolean;
  prepare?: (params: TradeActionParams, traded: TradeToken, count: number) => Promise<PreparedMoneyAction>;
  execute?: () => Promise<{ id: string; status: "rejected" | "submitted" }>;
  fetchAccountResource?: (path: string) => Promise<unknown>;
  assetPrice?: { currency: string; perUnit: { atoms: string; scale: number } } | null;
  scheduler?: ExpiryScheduler;
};
function dialog(direction: TradeDirection, options: DialogOptions = {}) {
  const traded = token(options.decimals ?? 18);
  const requests: TradeActionParams[] = [];
  let executions = 0;
  const tree = <TradeMoneyDialog open direction={direction} session={session}
    token={traded} assetName="DEGEN"
    availableBaseUnits={options.balance ?? (direction === "buy" ? "10000000" : "123000000000000000000")}
    assetPrice={options.assetPrice}
    fetchAccountResource={options.fetchAccountResource ?? (async () => ({ version: 1, usdcReserveBaseUnits: "20000" }))}
    prepareMoneyAction={async (_kind, input) => {
      const request = input as TradeActionParams;
      requests.push(request);
      if (options.error) throw { code: options.error, message: "untrusted provider text" };
      return options.prepare ? options.prepare(request, traded, requests.length)
        : action(direction, request.amountBaseUnits, traded, options.expired && requests.length === 1);
    }}
    executeMoneyAction={async () => {
      executions++;
      return options.execute ? options.execute() : { id: "fixture", status: "rejected" };
    }} onClose={() => undefined} />;
  const view = render(options.scheduler ? <ExpirySchedulerContext value={options.scheduler}>{tree}</ExpirySchedulerContext> : tree);
  return { view, requests, executions: () => executions };
}
function click(view: ReturnType<typeof render>, name: string) {
  const buttons = view.getAllByRole("button", { name });
  fireEvent.click(buttons[buttons.length - 1]!);
}
async function submit(view: ReturnType<typeof render>, value?: string) {
  if (value) fireEvent.input(view.getByRole("textbox", { name: "Amount" }), { target: { value } });
  await waitFor(() => expect((view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  click(view, "Continue");
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

describe("any-token trade review", () => {
  test.each([
    ["buy", "USDC"], ["sell", "DEGEN"],
  ] as const)("%s amount shows the locked %s asset in the header, then Back on confirm", async (direction, assetLabel) => {
    const trade = dialog(direction);
    const header = trade.view.getByRole("dialog", { name: `${direction === "buy" ? "Buy" : "Sell"} DEGEN` }).querySelector('[data-slot="drawer-header"]') as HTMLElement;
    expect(within(header).getByRole("group", { name: assetLabel })).toBeTruthy();
    expect(trade.view.queryByRole("combobox", { name: "Asset" })).toBeNull();
    expect(trade.view.getByRole("textbox", { name: "Amount" })).toBeTruthy();
    expect(trade.view.getByRole("dialog").querySelector('[data-slot="money-modal-body"] [role="group"][aria-label="' + assetLabel + '"]')).toBeNull();
    await submit(trade.view, direction === "buy" ? "1" : "0.5");
    await trade.view.findByRole("dialog", { name: "Confirm" });
    expect(trade.view.queryByRole("group", { name: assetLabel })).toBeNull();
    expect(within(trade.view.getByRole("dialog").querySelector('[data-slot="drawer-header"]') as HTMLElement).getByRole("button", { name: "Back" })).toBeTruthy();
  });
  test("sell only offers the fiat toggle when priced, and confirms the native token amount", async () => {
    const priced = dialog("sell", { assetPrice: { currency: "USD", perUnit: { atoms: "5", scale: 1 } } });
    expect(priced.view.getByRole("button", { name: /as the primary amount/ })).toBeTruthy();
    fireEvent.click(priced.view.getByRole("button", { name: /as the primary amount/ }));
    await submit(priced.view, "32.50");
    await waitFor(() => expect(priced.requests[0]?.amountBaseUnits).toBe("65000000000000000000"));
    expect(await priced.view.findByRole("button", { name: "Sell 65 DEGEN" })).toBeTruthy();
    cleanup();
    const unpriced = dialog("sell");
    expect(unpriced.view.queryByRole("button", { name: /as the primary amount/ })).toBeNull();
  });
  test("Buy Max spends exact Cash less the network-fee reserve", async () => {
    const trade = dialog("buy");
    await waitFor(() => expect((trade.view.getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false));
    click(trade.view, "Max");
    await submit(trade.view);
    await waitFor(() => expect(trade.requests).toEqual([{ version: 2, assetId: token(18).assetId, direction: "buy", amountBaseUnits: "9980000" }]));
  });
  test.each([6, 8, 18])("%i-decimal partial sell converts exactly", async (decimals) => {
    const trade = dialog("sell", { decimals, balance: (BigInt(10) ** BigInt(decimals)).toString() });
    await submit(trade.view, "0.125");
    await waitFor(() => expect(trade.requests[0]?.amountBaseUnits).toBe((BigInt(125) * BigInt(10) ** BigInt(decimals - 3)).toString()));
    expect(trade.view.getByText("You get").parentElement?.textContent).toContain("≈ $69.00");
    expect(trade.view.getByRole("button", { name: /Sell 0.125 DEGEN/ })).toBeTruthy();
  });
  test("Sell Max sends all and review uses the server's exact spend", async () => {
    const trade = dialog("sell");
    await waitFor(() => expect((trade.view.getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false));
    click(trade.view, "Max");
    await submit(trade.view);
    await waitFor(() => expect(trade.requests[0]?.amountBaseUnits).toBe("all"));
    expect(trade.view.getByRole("button", { name: "Sell 123 DEGEN" })).toBeTruthy();
  });
  test("a typed sell amount equal to the balance stays an explicit amount", async () => {
    const trade = dialog("sell");
    await submit(trade.view, "123");
    await waitFor(() => expect(trade.requests[0]?.amountBaseUnits).toBe("123000000000000000000"));
  });
  test("editing after Max drops the sell-all intent", async () => {
    const trade = dialog("sell");
    await waitFor(() => expect((trade.view.getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false));
    click(trade.view, "Max");
    await submit(trade.view, "12");
    await waitFor(() => expect(trade.requests[0]?.amountBaseUnits).toBe("12000000000000000000"));
  });
  test.each(["buy", "sell"] as const)("%s review keeps the traded contract behind Details", async (direction) => {
    const trade = dialog(direction);
    await submit(trade.view, direction === "buy" ? "1" : "0.5");
    const toggle = await trade.view.findByRole("button", { name: "Details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(trade.view.queryByText("DEGEN contract")).toBeNull();
    expect(trade.view.queryByRole("button", { name: /^Show full contract 0x/ })).toBeNull();
    click(trade.view, "Details");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(trade.view.getAllByText("DEGEN contract")).toHaveLength(1);
    const reveal = trade.view.getByRole("button", { name: /^Show full contract 0x/ });
    expect(reveal.getAttribute("title")).toBe(token(18).address);
    expect(reveal.textContent).toContain("0x2222");
    click(trade.view, "Details");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(trade.view.queryByText("DEGEN contract")).toBeNull();
  });
  test("review shows expected receive and network fee until Details exposes quote facts", async () => {
    const trade = dialog("buy");
    await submit(trade.view, "1");
    const toggle = await trade.view.findByRole("button", { name: "Details" });
    expect(trade.view.getByText("You get").parentElement?.textContent).toContain("≈ 1 DEGEN");
    expect(trade.view.getByText("Network fee").parentElement?.textContent).toContain("USDC");
    expect(trade.view.queryByText("You pay")).toBeNull();
    expect(trade.view.queryByText("You receive (estimated)")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(trade.view.queryByText("Minimum received")).toBeNull();
    click(trade.view, "Details");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(trade.view.getByText("Minimum received").parentElement?.textContent).toContain("DEGEN");
    expect(trade.view.getByText("Rate").parentElement?.textContent).toContain("1 DEGEN");
    expect(trade.view.getByText("Max slippage").parentElement?.textContent).toContain("1%");
    expect(trade.view.getByText("Quote expires in")).toBeTruthy();
    expect(trade.view.getByText("Network").parentElement?.textContent).toBe("NetworkBase");
    expect(trade.view.getByText("From")).toBeTruthy();
    expect(trade.view.queryByText("Do not use this warning for review facts")).toBeNull();
    click(trade.view, "Details");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(trade.view.queryByText("Minimum received")).toBeNull();
  });
  test("review lists the protocol fee but not the provider's gas estimate", async () => {
    const trade = dialog("buy", { prepare: async (params, traded) => {
      const prepared = action("buy", params.amountBaseUnits, traded);
      const metadata = prepared.metadata as TradeMoneyActionMetadata;
      metadata.fees = [
        { kind: "gas", assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "12000" },
        { kind: "protocol", assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1500" },
      ];
      return prepared;
    } });
    await submit(trade.view, "1");
    await trade.view.findByRole("button", { name: "Details" });
    click(trade.view, "Details");
    expect(trade.view.getByText("Protocol fee")).toBeTruthy();
    expect(trade.view.queryByText("Gas fee")).toBeNull();
  });
  test("expired quote prepares a new action instead of executing the stale one", async () => {
    const trade = dialog("sell", { expired: true });
    await submit(trade.view, "0.5");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Get new quote" })).toBeTruthy());
    click(trade.view, "Details");
    expect(trade.view.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("true");
    click(trade.view, "Get new quote");
    await waitFor(() => expect(trade.requests).toHaveLength(2));
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("false"));
    expect(trade.view.queryByText("Minimum received")).toBeNull();
    expect(trade.requests[1]).toEqual(trade.requests[0]);
    expect(trade.executions()).toBe(0);
  });
  test("Trade confirm X closes once and Back returns exactly to Buy amount", async () => {
    let closes = 0;
    function Journey() {
      const [open, setOpen] = useState(true);
      return <TradeMoneyDialog open={open} direction="buy" session={session} token={token(18)} assetName="DEGEN" availableBaseUnits="10000000"
        fetchAccountResource={async (path) => path === "/api/actions/trade-pending"
          ? { version: 1, trade: null } : { version: 1, usdcReserveBaseUnits: "20000" }}
        prepareMoneyAction={async (_kind, params) => action("buy", (params as TradeActionParams).amountBaseUnits, token(18))}
        executeMoneyAction={async () => ({ id: "fixture", status: "rejected" })}
        onClose={() => { closes++; setOpen(false); }} />;
    }
    const view = render(<Journey />);
    await submit(view, "1");
    await view.findByRole("dialog", { name: "Confirm" });
    click(view, "Back");
    expect((view.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1");
    expect(view.getAllByRole("dialog")).toHaveLength(1);
    await submit(view);
    await view.findByRole("dialog", { name: "Confirm" });
    click(view, "Close trade dialog");
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(closes).toBe(1);
  });

  test("Trade amount to confirm and Back keeps one dialog and refocuses amount", async () => {
    const trade = dialog("buy");
    await submit(trade.view, "1");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    const dialogElement = trade.view.getByRole("dialog", { name: "Confirm" });
    expect(trade.view.getAllByRole("dialog")).toHaveLength(1);
    expect(dialogElement.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    click(trade.view, "Back");
    expect(trade.view.getAllByRole("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(trade.view.getByRole("textbox", { name: "Amount" }));
  });

  test("waiting for a quote keeps the amount step with a busy Continue", async () => {
    let resolveQuote: (value: PreparedMoneyAction) => void = () => undefined;
    const trade = dialog("buy", { prepare: () => new Promise((resolve) => { resolveQuote = resolve; }) });
    await submit(trade.view, "1");
    const primary = await waitFor(() => trade.view.getByRole("button", { name: "Getting quote…" }));
    expect(primary.getAttribute("aria-busy")).toBe("true");
    expect(trade.view.getByRole("dialog", { name: "Buy DEGEN" })).toBeTruthy();
    expect((trade.view.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("1");
    expect(trade.view.queryByRole("status")).toBeNull();
    expect((trade.view.getByRole("button", { name: "Close trade dialog" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(primary);
    expect(trade.requests).toHaveLength(1);
    resolveQuote(action("buy", trade.requests[0]!.amountBaseUnits, token(18)));
    await waitFor(() => expect(trade.view.getByRole("dialog", { name: "Confirm" })).toBeTruthy());
    expect(trade.view.getByRole("button", { name: "Buy $1.00" }).getAttribute("aria-busy")).toBeNull();
  });
  test("waiting for a quote locks the amount and Max, and the quote reviews the locked amount", async () => {
    let resolveQuote: (value: PreparedMoneyAction) => void = () => undefined;
    const trade = dialog("sell", { prepare: () => new Promise((resolve) => { resolveQuote = resolve; }) });
    const input = trade.view.getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "0.5" } });
    await waitFor(() => expect((trade.view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Getting quote…" })).toBeTruthy());
    expect(input.readOnly).toBe(true);
    expect(document.activeElement).toBe(input);
    const max = trade.view.getByRole("button", { name: "Max" }) as HTMLButtonElement;
    expect(max.disabled).toBe(true);
    fireEvent.input(input, { target: { value: "2" } });
    fireEvent.click(max);
    expect(input.value).toBe("0.5");
    expect(trade.requests).toHaveLength(1);
    resolveQuote(action("sell", trade.requests[0]!.amountBaseUnits, token(18)));
    await waitFor(() => expect(trade.view.getByRole("dialog", { name: "Confirm" })).toBeTruthy());
    expect(trade.view.getByRole("button", { name: "Sell 0.5 DEGEN" })).toBeTruthy();
  });
  test("a quote expiring during the wallet request keeps the busy Buy until it settles", async () => {
    let now = Date.now();
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const scheduler: ExpiryScheduler = {
      now: () => now,
      setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout(id) { timers.delete(id); },
    };
    const flush = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
    let resolveExecute: (value: { id: string; status: "rejected" }) => void = () => undefined;
    const trade = dialog("buy", { scheduler, execute: () => new Promise((resolve) => { resolveExecute = resolve; }) });
    await submit(trade.view, "1");
    click(trade.view, await waitFor(() => trade.view.getByRole("button", { name: "Buy $1.00" }).textContent!));
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" }).getAttribute("aria-busy")).toBe("true"));
    now += 200_000;
    act(() => { flush(); flush(); });
    expect(trade.view.queryByRole("button", { name: "Get new quote" })).toBeNull();
    expect(trade.view.getByRole("button", { name: "Buy $1.00" }).getAttribute("aria-busy")).toBe("true");
    resolveExecute({ id: "fixture", status: "rejected" });
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Get new quote" }).getAttribute("aria-busy")).toBeNull());
    expect(trade.executions()).toBe(1);
  });
  test("waiting for the wallet keeps the review with a busy Buy and disabled Back", async () => {
    let resolveExecute: (value: { id: string; status: "rejected" }) => void = () => undefined;
    const trade = dialog("buy", { execute: () => new Promise((resolve) => { resolveExecute = resolve; }) });
    await submit(trade.view, "1");
    click(trade.view, await waitFor(() => trade.view.getByRole("button", { name: "Buy $1.00" }).textContent!));
    const primary = await waitFor(() => {
      const button = trade.view.getByRole("button", { name: "Buy $1.00" });
      expect(button.getAttribute("aria-busy")).toBe("true");
      return button;
    });
    expect(trade.view.getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(trade.view.getByText("You get")).toBeTruthy();
    expect(trade.view.queryByRole("status")).toBeNull();
    expect(trade.view.getAllByRole("button", { name: "Back" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(primary);
    expect(trade.executions()).toBe(1);
    resolveExecute({ id: "fixture", status: "rejected" });
    await waitFor(() => expect(trade.view.getByText(/wallet request was rejected/)).toBeTruthy());
    expect(trade.view.getByRole("button", { name: "Buy $1.00" }).getAttribute("aria-busy")).toBeNull();
  });
  test("wallet rejection keeps the same review, and Back retains the amount", async () => {
    const trade = dialog("buy");
    await submit(trade.view, "1");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    click(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByText(/wallet request was rejected/)).toBeTruthy());
    click(trade.view, "Details");
    expect(trade.view.getByText("Minimum received")).toBeTruthy();
    expect(trade.executions()).toBe(1);
    click(trade.view, "Back");
    expect((trade.view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("wallet rejection followed by expiry gets a fresh quote without executing again", async () => {
    const trade = dialog("sell", { prepare: async (params, traded, count) => {
      const prepared = action("sell", params.amountBaseUnits, traded);
      if (count === 1) prepared.expiresAt = new Date(Date.now() + 1200).toISOString();
      return prepared;
    } });
    await submit(trade.view, "0.5");
    const confirm = await waitFor(() => trade.view.getByRole("button", { name: /Sell .* DEGEN/ }));
    expect(confirm.getAttribute("data-money-action-id")).toBeTruthy();
    click(trade.view, confirm.textContent!);
    await waitFor(() => expect(trade.view.getByText(/wallet request was rejected/)).toBeTruthy());
    expect(trade.executions()).toBe(1);
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Get new quote" }).hasAttribute("data-money-action-id")).toBe(false), { timeout: 2000 });
    click(trade.view, "Get new quote");
    await waitFor(() => expect(trade.requests).toHaveLength(2));
    expect(trade.requests[1]).toEqual(trade.requests[0]);
    expect(trade.executions()).toBe(1);
  });
  test("signing failure retains Buy and offers a new quote after expiry", async () => {
    const trade = dialog("buy", {
      prepare: async (params, traded) => {
        const prepared = action("buy", params.amountBaseUnits, traded);
        prepared.expiresAt = new Date(Date.now() + 1200).toISOString();
        return prepared;
      },
      execute: async () => { throw new TransferExecutionError("not-submitted"); },
    });
    await submit(trade.view, "1");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    click(trade.view, "Buy $1.00");
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
    await submit(trade.view, "1");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    click(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toBe("This quote can't be signed. Get a new quote."));
    expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy();
  });
  test("an ambiguous dispatch has no Retry, but reopening permits a new trade", async () => {
    const paths: string[] = [];
    let prepares = 0;
    let dispatches = 0;
    const options = {
      prepare: async (params: TradeActionParams, traded: TradeToken) => { prepares++; return action("buy", params.amountBaseUnits, traded); },
      execute: async (): Promise<{ id: string; status: "submitted" }> => {
        dispatches++;
        throw new TransferExecutionError("dispatch-unknown");
      },
      fetchAccountResource: async (path: string) => {
        paths.push(path);
        return { version: 1, usdcReserveBaseUnits: "20000" };
      },
    };
    const initial = dialog("buy", options);
    await submit(initial.view, "1");
    await waitFor(() => expect(initial.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    click(initial.view, "Buy $1.00");
    await waitFor(() => expect(initial.view.getByRole("alert").textContent).toContain("Check Activity"));
    expect(initial.view.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(initial.view.queryByRole("button", { name: "Continue" })).toBeNull();
    click(initial.view, "Close trade dialog");
    initial.view.unmount();
    const next = dialog("buy", options);
    await submit(next.view, "2");
    await waitFor(() => expect(next.view.getByRole("button", { name: "Buy $2.00" })).toBeTruthy());
    expect({ prepares, dispatches }).toEqual({ prepares: 2, dispatches: 1 });
    expect(paths.every((path) => path === "/api/actions/network-fee")).toBe(true);
  });
  test("a lost confirm response retains Retry on the same trade", async () => {
    const trade = dialog("buy", { execute: async () => { throw new TransferExecutionError("submission-unknown"); } });
    await submit(trade.view, "1");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    click(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(trade.view.getByRole("alert").textContent).toContain("Retry to record the same trade");
    expect(trade.requests).toHaveLength(1);
  });
  test("signing failure does not clear a previous unresolved dispatch", async () => {
    let attempts = 0;
    const trade = dialog("buy", { execute: async () => {
      if (++attempts === 1) throw new Error("synthetic dispatch outcome unknown");
      throw new TransferExecutionError("not-submitted");
    } });
    await submit(trade.view, "1");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Buy $1.00" })).toBeTruthy());
    click(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByRole("button", { name: "Retry" })).toBeTruthy());
    click(trade.view, "Retry");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toBe("Couldn't sign this trade. Try again or get a new quote."));
    expect(trade.view.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(trade.view.queryAllByRole("button", { name: "Back" })).toHaveLength(0);
  });
  test("unresolved dispatch removes both Back affordances after a later rejection", async () => {
    let attempts = 0;
    const trade = dialog("buy", { execute: async () => {
      if (++attempts === 1) throw new Error("synthetic dispatch outcome unknown");
      return { id: "fixture", status: "rejected" };
    } });
    await submit(trade.view, "1");
    await waitFor(() => expect(trade.view.getAllByRole("button", { name: "Back" })).toHaveLength(2));
    click(trade.view, "Buy $1.00");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toContain("Retry to record the same trade"));
    expect(trade.view.queryAllByRole("button", { name: "Back" })).toHaveLength(0);
    click(trade.view, "Retry");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toContain("wallet request was rejected"));
    expect(trade.view.queryAllByRole("button", { name: "Back" })).toHaveLength(0);
    expect(trade.view.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(trade.executions()).toBe(2);
  });
  test("unresolved dispatch loses Retry and the money marker once its quote expires", async () => {
    const trade = dialog("buy", {
      prepare: async (params, traded) => {
        const prepared = action("buy", params.amountBaseUnits, traded);
        prepared.expiresAt = new Date(Date.now() + 1200).toISOString();
        return prepared;
      },
      execute: async () => { throw new Error("synthetic dispatch outcome unknown"); },
    });
    await submit(trade.view, "1");
    const confirm = await waitFor(() => trade.view.getByRole("button", { name: "Buy $1.00" }));
    expect(confirm.getAttribute("data-money-action-id")).toBeTruthy();
    click(trade.view, "Buy $1.00");
    const retry = await waitFor(() => trade.view.getByRole("button", { name: "Retry" }));
    expect(retry.getAttribute("data-money-action-id")).toBe(confirm.getAttribute("data-money-action-id"));
    await waitFor(() => {
      const primary = trade.view.getByRole("button", { name: /^Close$/ });
      expect(primary.hasAttribute("data-money-action-id")).toBe(false);
      expect(trade.view.getByRole("alert").textContent).toBe("This quote expired before the outcome was recorded. Check Activity before trading again.");
    }, { timeout: 2000 });
    expect(trade.view.queryAllByRole("button", { name: "Back" })).toHaveLength(0);
    click(trade.view, "Close");
    expect(trade.executions()).toBe(1);
    expect(trade.view.queryByRole("button", { name: "Continue" })).toBeNull();
  });
  test("a failed network-fee check offers Try again and recovers Buy", async () => {
    let settle: (() => void) | undefined;
    let requests = 0;
    const trade = dialog("buy", { fetchAccountResource: async () => {
      requests++;
      if (requests <= 3) throw new Error("synthetic fee policy failure");
      return new Promise((resolve) => { settle = () => resolve({ version: 1, usdcReserveBaseUnits: "20000" }); });
    } });
    fireEvent.input(trade.view.getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
    await waitFor(() => expect(trade.view.getByText("Couldn't check the network fee.")).toBeTruthy());
    expect(trade.view.getAllByText("Network fee unavailable").length).toBeGreaterThan(0);
    expect((trade.view.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    const retry = trade.view.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("true"));
    expect(retry.isConnected).toBe(true);
    fireEvent.click(retry);
    settle?.();
    await submit(trade.view);
    await waitFor(() => expect(trade.requests[0]?.amountBaseUnits).toBe("1000000"));
    expect(requests).toBe(4);
  });
  test.each([
    ["TRADE_NOT_ROUTED", "This asset can't be traded in Home yet."],
    ["TRADE_STOCK_RESTRICTED", "Stock buys aren't available in your location."],
    ["TRADE_ROUTE_UNAVAILABLE", "No route for this amount. Try a different amount or try again later."],
    ["TRADE_BELOW_MINIMUM", "This amount is below the trade minimum. Enter a larger amount."],
    ["TRADE_TOKEN_UNREADABLE", "This token couldn't be read on Base. Try again later."],
    ["TRADE_BUY_UNAVAILABLE", "Buying is unavailable. You can still sell or send."],
    ["TRADE_INSUFFICIENT_BALANCE", "Your Cash balance changed. Review the amount again."],
    ["TRADE_QUOTE_STALE", "This quote changed. Get a new quote."],
    ["TRADE_UNAVAILABLE", "Trading isn't available right now. Try again later."],
  ] as const)("%s gives a specific recovery without provider text", async (error, message) => {
    const trade = dialog("buy", { error });
    await submit(trade.view, "1");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toBe(message));
    expect(trade.view.queryByText("untrusted provider text")).toBeNull();
    expect(trade.view.queryByRole("button", { name: /Buy \$/ })).toBeNull();
  });
});
