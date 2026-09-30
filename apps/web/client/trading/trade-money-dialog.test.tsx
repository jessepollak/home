import { parseAddress } from "@/shared/chain/hex";
import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { pinClock } from "@/tests/helpers/pin-clock";
import { useState } from "react";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import { TransferExecutionError } from "@/shared/transfers/types";
import { OPERATOR_FEE_TOKEN } from "@/shared/fees/contract";
import type { TradeActionParams, TradeDirection, TradeMoneyActionMetadata, TradeToken } from "@/shared/trading/contract";
import { cashConversionCurrencies } from "@/shared/trading/cash-conversion";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { TradeMoneyDialog, TradeMoneyFlow } = await import("./trade-money-dialog");
const { MoneyModal } = await import("@/client/money-modal");

const wallet = "0x1111111111111111111111111111111111111111" as const;
const usdc = parseAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")!;
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
let restoreClock: () => void;
beforeEach(() => { restoreClock = pinClock("2026-09-28T12:00:00.000Z"); });
const session: VerifiedAccountSession = {
  user: { subject: "synthetic-trade-owner" }, smartAccount: { address: wallet, chainId: 8453 }, accountProvider: "cdp-embedded",
};
const token = (decimals: number): TradeToken => ({
  assetId: "base:0x2222222222222222222222222222222222222222",
  symbol: "DEGEN", decimals, address: parseAddress("0x2222222222222222222222222222222222222222")!,
});

function action(direction: TradeDirection, amount: string, traded: TradeToken, expired = false): PreparedMoneyAction {
  const buy = direction === "buy";
  const spend = amount === "all" ? "123000000000000000000" : amount;
  const cash = { id: "usdc", symbol: "USDC", decimals: 6, address: usdc };
  const tradedAsset = { id: traded.assetId, symbol: traded.symbol, decimals: traded.decimals, address: traded.address };
  const from = buy ? cash : tradedAsset;
  const to = buy ? tradedAsset : cash;
  const receive = buy ? (BigInt(10) ** BigInt(traded.decimals)).toString() : "69000000";
  const expiresAt = new Date(NOW + (expired ? -1000 : 110_000)).toISOString();
  return {
    id: `fixture-${direction}-${expiresAt}`, kind: "trade", title: `${buy ? "Buy" : "Sell"} DEGEN`,
    owner: { subject: session.user.subject, address: wallet, chainId: 8453, accountProvider: session.accountProvider },
    createdAt: new Date(NOW).toISOString(), expiresAt, calls: [], warnings: ["Do not use this warning for review facts"],
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
      slippageBps: 100, fees: [], approval: "permit2-exact", quoteBlockNumber: "123", quotedAt: new Date(NOW).toISOString(),
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
};
function dialog(direction: TradeDirection, options: DialogOptions = {}) {
  const traded = token(options.decimals ?? 18);
  const requests: TradeActionParams[] = [];
  let executions = 0;
  const view = render(<TradeMoneyDialog open direction={direction} session={session}
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
    }} onClose={() => undefined} />);
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

afterEach(() => { cleanup(); getHomeQueryClient().clear(); restoreClock(); });

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
    await waitFor(() => expect(trade.requests).toEqual([{ version: 3, assetId: token(18).assetId, direction: "buy", amountBaseUnits: "9980000" }]));
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
      if (count === 1) prepared.expiresAt = new Date(NOW + 1200).toISOString();
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
        prepared.expiresAt = new Date(NOW + 1200).toISOString();
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
        prepared.expiresAt = new Date(NOW + 1200).toISOString();
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

const feeRecipient = "0x3333333333333333333333333333333333333333" as const;
function feeAction(direction: TradeDirection, amount: string, traded: TradeToken, feeBaseUnits: string, customerAmounts = true): PreparedMoneyAction {
  const prepared = action(direction, amount, traded);
  const metadata = prepared.metadata as TradeMoneyActionMetadata;
  metadata.operatorFee = { amountBaseUnits: feeBaseUnits, token: OPERATOR_FEE_TOKEN, bps: 50, recipient: feeRecipient, collectedBy: "in-batch-transfer" };
  const fee = BigInt(feeBaseUnits);
  if (direction === "buy") {
    metadata.fromAmountBaseUnits = (BigInt(amount) - fee).toString();
    if (!customerAmounts) prepared.amounts[0] = { ...prepared.amounts[0]!, amountBaseUnits: metadata.fromAmountBaseUnits };
  } else {
    metadata.expectedToAmountBaseUnits = "70700000";
    metadata.minimumToAmountBaseUnits = "70000000";
    prepared.amounts[1] = { ...prepared.amounts[1]!, amountBaseUnits: customerAmounts ? (BigInt(70_700_000) - fee).toString() : "70700000" };
  }
  return prepared;
}
function row(view: ReturnType<typeof render>, label: string) {
  return view.getByText(label).nextElementSibling?.textContent;
}

describe("trade review service fee", () => {
  test("buy shows the service fee up front and charges it within the entered Cash amount", async () => {
    const trade = dialog("buy", { balance: "20000000", prepare: async (params, traded) => feeAction("buy", params.amountBaseUnits, traded, "50000") });
    await submit(trade.view, "10");
    await trade.view.findByRole("button", { name: "Details" });
    expect(row(trade.view, "Service fee")).toBe("$0.05 (0.5%)");
    expect(row(trade.view, "You get")).toBe("≈ 1 DEGEN");
    expect(trade.view.getByRole("button", { name: "Buy $10.00" })).toBeTruthy();
    click(trade.view, "Details");
    expect(row(trade.view, "Minimum received")).toBe("0.99 DEGEN");
  });
  test("sell takes the service fee from the USDC received and the guaranteed minimum", async () => {
    const trade = dialog("sell", { prepare: async (params, traded) => feeAction("sell", params.amountBaseUnits, traded, "350000") });
    await submit(trade.view, "0.5");
    await trade.view.findByRole("button", { name: "Details" });
    expect(row(trade.view, "You get")).toBe("≈ $70.35");
    expect(row(trade.view, "Service fee")).toBe("$0.35 (0.5%)");
    expect(trade.view.getByRole("button", { name: "Sell 0.5 DEGEN" })).toBeTruthy();
    click(trade.view, "Details");
    expect(row(trade.view, "Minimum received")).toBe("$69.65");
  });
  test.each(["buy", "sell"] as const)("%s without an operator fee has no service fee row", async (direction) => {
    const trade = dialog(direction);
    await submit(trade.view, direction === "buy" ? "1" : "0.5");
    await trade.view.findByRole("button", { name: "Details" });
    click(trade.view, "Details");
    expect(trade.view.queryByText("Service fee")).toBeNull();
  });
  test.each([
    ["buy spend omits the fee", "buy", "50000", false],
    ["sell receive ignores the fee", "sell", "350000", false],
    ["buy fee exceeds its rate", "buy", "50001", true],
    ["sell fee exceeds its rate", "sell", "350001", true],
  ] as const)("a quote whose %s is rejected", async (_case, direction, fee, customerAmounts) => {
    const trade = dialog(direction, { balance: direction === "buy" ? "20000000" : undefined,
      prepare: async (params, traded) => feeAction(direction, params.amountBaseUnits, traded, fee, customerAmounts) });
    await submit(trade.view, direction === "buy" ? "10" : "0.5");
    await waitFor(() => expect(trade.view.getByRole("alert").textContent).toBe("The quote did not match this account or trade. Get a new quote."));
    expect(trade.view.queryByText("Service fee")).toBeNull();
  });
});
describe("cash conversion trade flow", () => {
  const usd = cashConversionCurrencies.find((currency) => currency.code === "USD")!;
  const eur = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
  const localToken: TradeToken = { assetId: eur.tradeAssetId, address: eur.address, symbol: eur.symbol, decimals: eur.decimals };
  const conversion = { from: usd, to: eur };
  const common = {
    direction: "buy" as const, session, token: localToken, assetName: eur.name, availableBaseUnits: "10000000",
    conversion, fetchAccountResource: async () => ({ version: 1, usdcReserveBaseUnits: "20000" }),
    executeMoneyAction: async () => ({ id: "fixture", status: "rejected" as const }),
  };
  test("amount and review use cash names and amounts while prepare retains the exact buy route", async () => {
    const requests: TradeActionParams[] = [];
    const view = render(<TradeMoneyDialog {...common} open onClose={() => undefined}
      prepareMoneyAction={async (_kind, input) => {
        const params = input as TradeActionParams;
        requests.push(params);
        return action("buy", params.amountBaseUnits, localToken);
      }} />);
    expect(view.getByRole("dialog", { name: "Convert to Euro" })).toBeTruthy();
    expect(view.getByRole("group", { name: "USDC" })).toBeTruthy();
    await submit(view, "1.25");
    expect(requests).toEqual([{ version: 3, assetId: eur.tradeAssetId, direction: "buy", amountBaseUnits: "1250000" }]);
    await view.findByText("Convert USD to EUR");
    expect(view.getByText("You pay").parentElement?.textContent).toContain("$1.25");
    expect(view.getByText("You receive").parentElement?.textContent).toContain("€1.00");
    expect(view.getByText("Rate")).toBeTruthy();
    expect(view.getByRole("button", { name: "Convert $1.25" })).toBeTruthy();
    click(view, "Details");
    for (const label of ["Minimum received", "Max slippage", "Quote expires in", "Network", "From"]) expect(view.getByText(label)).toBeTruthy();
    expect(view.getByText("EURC contract")).toBeTruthy();
  });
  test("a fee-bearing conversion pays the gross cash amount and itemizes the service fee", async () => {
    const view = render(<TradeMoneyDialog {...common} open availableBaseUnits="20000000" onClose={() => undefined}
      prepareMoneyAction={async (_kind, input) => feeAction("buy", (input as TradeActionParams).amountBaseUnits, localToken, "50000")} />);
    await submit(view, "10");
    await view.findByText("Convert USD to EUR");
    expect(row(view, "You pay")).toBe("$10.00");
    expect(row(view, "You receive")).toBe("≈ €1.00");
    expect(row(view, "Service fee")).toBe("$0.05 (0.5%)");
    expect(view.getByRole("button", { name: "Convert $10.00" })).toBeTruthy();
  });
  test("a fee-bearing sell conversion takes the service fee from the received cash and its minimum", async () => {
    const view = render(<TradeMoneyDialog {...common} open direction="sell" token={localToken} conversion={{ from: eur, to: usd }} onClose={() => undefined}
      prepareMoneyAction={async (_kind, input) => feeAction("sell", (input as TradeActionParams).amountBaseUnits, localToken, "350000")} />);
    await submit(view, "0.5");
    await view.findByText("Convert EUR to USD");
    expect(row(view, "You pay")).toBe("€0.50");
    expect(row(view, "You receive")).toBe("≈ $70.35");
    expect(row(view, "Service fee")).toBe("$0.35 (0.5%)");
    expect(view.getByRole("button", { name: "Convert €0.50" })).toBeTruthy();
    click(view, "Details");
    expect(row(view, "Minimum received")).toBe("$69.65");
  });
  test("review and the marked confirm control keep the exact six-decimal cash amounts", async () => {
    const view = render(<TradeMoneyDialog {...common} open onClose={() => undefined}
      prepareMoneyAction={async (_kind, input) => {
        const prepared = action("buy", (input as TradeActionParams).amountBaseUnits, localToken);
        const metadata = prepared.metadata as TradeMoneyActionMetadata;
        metadata.fromAmountBaseUnits = "1234567";
        metadata.expectedToAmountBaseUnits = "1980123";
        metadata.minimumToAmountBaseUnits = "1960322";
        prepared.amounts = [
          { assetId: metadata.fromAsset.id, symbol: metadata.fromAsset.symbol, decimals: metadata.fromAsset.decimals, amountBaseUnits: "1234567", direction: "spend" },
          { assetId: metadata.toAsset.id, symbol: metadata.toAsset.symbol, decimals: metadata.toAsset.decimals, amountBaseUnits: "1980123", direction: "receive", estimated: true },
        ];
        return prepared;
      }} />);
    await submit(view, "1.234567");
    await view.findByText("Convert USD to EUR");
    expect(view.getByText("You pay").parentElement?.textContent).toContain("$1.234567");
    expect(view.getByText("You receive").parentElement?.textContent).toContain("€1.980123");
    expect(view.getByRole("button", { name: "Convert $1.234567" })).toBeTruthy();
    click(view, "Details");
    expect(view.getByText("Minimum received").parentElement?.textContent).toContain("€1.960322");
  });
  test("IDR to USD keeps the exact two-decimal sell amount and existing trade asset id", async () => {
    const idr = cashConversionCurrencies.find((currency) => currency.code === "IDR")!;
    const idrToken: TradeToken = { assetId: idr.tradeAssetId, address: idr.address, symbol: idr.symbol, decimals: idr.decimals };
    const requests: TradeActionParams[] = [];
    const view = render(<TradeMoneyDialog {...common} open direction="sell" token={idrToken} assetName={idr.name}
      conversion={{ from: idr, to: usd }} availableBaseUnits="100000"
      onClose={() => undefined} prepareMoneyAction={async (_kind, input) => {
        const request = input as TradeActionParams;
        requests.push(request);
        return action("sell", request.amountBaseUnits, idrToken);
      }} />);
    expect(view.getByRole("dialog", { name: "Convert to US dollar" })).toBeTruthy();
    await submit(view, "12.34");
    expect(requests).toEqual([{ version: 3, assetId: idr.tradeAssetId, direction: "sell", amountBaseUnits: "1234" }]);
    expect(await view.findByText("Convert IDR to USD")).toBeTruthy();
  });
  test("embedded amount step uses Back at depth one and X exits its host", async () => {
    let backs = 0;
    let exits = 0;
    function Host() {
      const [open, setOpen] = useState(true);
      return <MoneyModal open={open} labelledBy="trade-action-title" onCancel={() => { exits++; setOpen(false); }} onClose={() => undefined}>
        <TradeMoneyFlow {...common} depth={1} onBack={() => { backs++; }} onDone={() => undefined} prepareMoneyAction={async (_kind, input) => action("buy", (input as TradeActionParams).amountBaseUnits, localToken)} />
      </MoneyModal>;
    }
    const view = render(<Host />);
    expect(view.getByRole("dialog", { name: "Convert to Euro" })).toBeTruthy();
    expect(view.getAllByRole("button", { name: "Back" })).toHaveLength(1);
    expect(view.queryByRole("group", { name: "USDC" })).toBeNull();
    click(view, "Back");
    expect(backs).toBe(1);
    click(view, "Close conversion");
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(exits).toBe(1);
  });
  test("conversion refuses a quote for a different cash contract", async () => {
    const view = render(<TradeMoneyDialog {...common} open onClose={() => undefined}
      prepareMoneyAction={async (_kind, input) => {
        const prepared = action("buy", (input as TradeActionParams).amountBaseUnits, localToken);
        const metadata = prepared.metadata as TradeMoneyActionMetadata;
        metadata.toAsset = { ...metadata.toAsset, address: parseAddress("0x2222222222222222222222222222222222222222")! };
        return prepared;
      }} />);
    await submit(view, "1");
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("conversion quote did not match"));
    expect(view.queryByRole("button", { name: "Convert $1.00" })).toBeNull();
  });
  test("onchain failure keeps conversion-specific recovery", async () => {
    const view = render(<TradeMoneyDialog {...common} open onClose={() => undefined}
      prepareMoneyAction={async (_kind, input) => action("buy", (input as TradeActionParams).amountBaseUnits, localToken)}
      executeMoneyAction={async () => ({ id: "fixture", status: "failed" })} />);
    await submit(view, "1");
    await view.findByRole("button", { name: "Convert $1.00" });
    click(view, "Convert $1.00");
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("This conversion did not succeed onchain. Check Activity before converting again."));
  });
  test("dispatch-unknown closes the wrapper and a new opening starts at amount", async () => {
    const attempts: [boolean, boolean | undefined][] = [];
    function Journey() {
      const [open, setOpen] = useState(true);
      return <><button onClick={() => setOpen(true)}>Reopen</button><TradeMoneyDialog {...common} open={open} onAttemptedChange={(value, unknown) => attempts.push([value, unknown])}
        onClose={() => setOpen(false)} prepareMoneyAction={async (_kind, input) => action("buy", (input as TradeActionParams).amountBaseUnits, localToken)}
        executeMoneyAction={async () => { throw new TransferExecutionError("dispatch-unknown"); }} /></>;
    }
    const view = render(<Journey />);
    await submit(view, "1");
    await view.findByRole("button", { name: "Convert $1.00" });
    click(view, "Convert $1.00");
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("may have been submitted"));
    expect(attempts.at(-1)).toEqual([true, true]);
    click(view, "Close");
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    click(view, "Reopen");
    expect(await view.findByRole("dialog", { name: "Convert to Euro" })).toBeTruthy();
    expect((view.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("");
  }, 20_000);
  test("unresolved execution reports attempted to the host without losing the prepared retry", async () => {
    const attempts: boolean[] = [];
    const view = render(<TradeMoneyDialog {...common} open onClose={() => undefined} onAttemptedChange={(value) => attempts.push(value)}
      prepareMoneyAction={async (_kind, input) => action("buy", (input as TradeActionParams).amountBaseUnits, localToken)}
      executeMoneyAction={async () => { throw new TransferExecutionError("submission-unknown"); }} />);
    await submit(view, "1");
    await view.findByRole("button", { name: "Convert $1.00" });
    click(view, "Convert $1.00");
    await view.findByRole("button", { name: "Retry" });
    expect(attempts.at(-1)).toBe(true);
    expect(view.getByRole("alert").textContent).toContain("same conversion");
  });
  test.each(["TRADE_NOT_ROUTED", "TRADE_ROUTE_UNAVAILABLE", "TRADE_INSUFFICIENT_BALANCE"] as const)("%s uses conversion-specific recovery", async (code) => {
    const view = render(<TradeMoneyDialog {...common} open onClose={() => undefined}
      prepareMoneyAction={async () => { throw { code }; }} />);
    await submit(view, "1");
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe(code === "TRADE_INSUFFICIENT_BALANCE"
      ? "Your US dollar balance changed. Review the amount again."
      : "Can't convert to Euro right now. Try a different amount or try again later."));
  });
  test("a successful conversion completes through its host while the pending close is still locked", async () => {
    let dones = 0;
    let resolveExecute: ((value: { id: string; status: "submitted" }) => void) | null = null;
    function Host() {
      const [open, setOpen] = useState(true);
      return <MoneyModal open={open} labelledBy="trade-action-title" onCancel={() => setOpen(false)} onClose={() => undefined}>
        <TradeMoneyFlow {...common} depth={1} onDone={() => { dones++; setOpen(false); }}
          prepareMoneyAction={async (_kind, input) => action("buy", (input as TradeActionParams).amountBaseUnits, localToken)}
          executeMoneyAction={async () => await new Promise((resolve) => { resolveExecute = resolve; })} />
      </MoneyModal>;
    }
    const view = render(<Host />);
    await submit(view, "1");
    await view.findByRole("button", { name: /Convert \$1\.00/ });
    click(view, "Convert $1.00");
    await view.findByText("Waiting for your wallet…");
    expect((view.getByRole("button", { name: "Close conversion" }) as HTMLButtonElement).disabled).toBe(true);
    resolveExecute!({ id: "fixture", status: "submitted" });
    await waitFor(() => expect(Boolean(view.queryByRole("dialog"))).toBe(false), { timeout: 2_000 });
    expect(dones).toBe(1);
  }, 20_000);
  test("a successful standalone trade closes its sheet", async () => {
    function Journey() {
      const [open, setOpen] = useState(true);
      return <TradeMoneyDialog {...common} open={open} onClose={() => setOpen(false)}
        prepareMoneyAction={async (_kind, input) => action("buy", (input as TradeActionParams).amountBaseUnits, localToken)}
        executeMoneyAction={async (prepared) => ({ id: prepared.id, status: "submitted" })} />;
    }
    const view = render(<Journey />);
    await submit(view, "1");
    await view.findByRole("button", { name: /Convert \$1\.00/ });
    click(view, "Convert $1.00");
    await waitFor(() => expect(Boolean(view.queryByRole("dialog"))).toBe(false), { timeout: 2_000 });
  }, 20_000);
  test("a stalled post-submission refresh cannot hold the sheet on the pending step", async () => {
    let closes = 0;
    const view = render(<TradeMoneyDialog {...common} open onClose={() => { closes++; }} onConfirmed={() => new Promise<void>(() => undefined)}
      prepareMoneyAction={async (_kind, input) => action("buy", (input as TradeActionParams).amountBaseUnits, localToken)}
      executeMoneyAction={async (prepared) => ({ id: prepared.id, status: "submitted" })} />);
    await submit(view, "1");
    await view.findByRole("button", { name: /Convert \$1\.00/ });
    click(view, "Convert $1.00");
    await waitFor(() => expect(closes).toBe(1), { timeout: 2_000 });
  }, 20_000);
  test("a confirmation superseded by unmount cannot complete or report to its host", async () => {
    let completes = 0;
    const attempts: boolean[] = [];
    let rejectExecute: ((reason: unknown) => void) | null = null;
    function Mount({ live }: { live: boolean }) {
      const [open, setOpen] = useState(true);
      return <MoneyModal open={open} labelledBy="trade-action-title" onCancel={() => setOpen(false)} onClose={() => undefined}>
        {live ? <TradeMoneyFlow {...common} depth={1} onDone={() => { completes++; setOpen(false); }} onAttemptedChange={(value) => attempts.push(value)}
          prepareMoneyAction={async (_kind, input) => action("buy", (input as TradeActionParams).amountBaseUnits, localToken)}
          executeMoneyAction={async () => await new Promise((_resolve, reject) => { rejectExecute = reject; })} /> : <span>Idle</span>}
      </MoneyModal>;
    }
    const view = render(<Mount live />);
    await submit(view, "1");
    await view.findByRole("button", { name: /Convert \$1\.00/ });
    click(view, "Convert $1.00");
    await view.findByText("Waiting for your wallet…");
    view.rerender(<Mount live={false} />);
    rejectExecute!(new TransferExecutionError("submission-unknown"));
    await act(async () => undefined);
    expect(completes).toBe(0);
    expect(attempts).not.toContain(true);
  }, 20_000);
  test("a confirmation that lands after unmount refreshes its host without completing it", async () => {
    let completes = 0;
    let refreshes = 0;
    let resolveExecute: ((value: { id: string; status: "submitted" }) => void) | null = null;
    function Mount({ live }: { live: boolean }) {
      const [open, setOpen] = useState(true);
      return <MoneyModal open={open} labelledBy="trade-action-title" onCancel={() => setOpen(false)} onClose={() => undefined}>
        {live ? <TradeMoneyFlow {...common} depth={1} onDone={() => { completes++; setOpen(false); }}
          onConfirmed={() => { refreshes++; }}
          prepareMoneyAction={async (_kind, input) => action("buy", (input as TradeActionParams).amountBaseUnits, localToken)}
          executeMoneyAction={async () => await new Promise((resolve) => { resolveExecute = resolve; })} /> : <span>Idle</span>}
      </MoneyModal>;
    }
    const view = render(<Mount live />);
    await submit(view, "1");
    await view.findByRole("button", { name: /Convert \$1\.00/ });
    click(view, "Convert $1.00");
    await view.findByText("Waiting for your wallet…");
    view.rerender(<Mount live={false} />);
    resolveExecute!({ id: "fixture", status: "submitted" });
    await act(async () => undefined);
    expect(completes).toBe(0);
    expect(refreshes).toBe(1);
  }, 20_000);
});
