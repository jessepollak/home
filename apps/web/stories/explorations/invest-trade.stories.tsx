import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExpirySchedulerContext, type ExpiryScheduler } from "@/client/actions/expiry";
import { Toaster } from "@/components/ui/toast";
import { TradeConvergence } from "@/client/explorations/trade/trade-convergence";
import { TradeDetail } from "@/client/explorations/trade/trade-detail";
import type { TradeAvailability } from "@/client/explorations/trade/trade-entry";
import { TradeSheet, type TradeStep } from "@/client/explorations/trade/trade-sheet";
import { TransferExecutionError, type TransferFailureReason } from "@/shared/transfers/types";
import {
  buyQuote, expiredQuote, fixtureHolding, fixtureNow, fixtureValidUntil,
  refreshedQuote, sellMaxQuote, sellPartialQuote,
  type TradeQuote,
} from "@/client/explorations/trade/trade-fixtures";

const amountStep: TradeStep = { name: "amount" };
const buyReview: TradeStep = { name: "review", quote: buyQuote };

type SurfaceProps = {
  scene?: "entry" | "sheet" | "convergence";
  availability?: TradeAvailability;
  side?: "buy" | "sell";
  initialState?: { step: TradeStep; amount: string };
  available?: string;
  reducedMotion?: boolean;
  rejectFirst?: boolean;
  deferQuotes?: boolean;
  deferExecution?: boolean;
  executeError?: TransferFailureReason | "generic";
  outcome?: "confirmed" | "submitted" | "unknown" | "failed";
} ;

function TradeStory({ scene = "entry", availability = "available", side = "buy", initialState, available, reducedMotion, rejectFirst = false, deferQuotes = false, deferExecution = false, executeError, outcome = "confirmed" }: SurfaceProps) {
  const [open, setOpen] = useState(scene === "sheet");
  const [activeSide, setActiveSide] = useState(side);
  const [nextQuote, setNextQuote] = useState(false);
  const executions = useRef(0);
  const buyButtonRef = useRef<HTMLButtonElement>(null);
  const sellButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const resolveQuote = useRef<(() => void) | null>(null);
  if (scene === "convergence") return <Toaster><TradeConvergence /></Toaster>;
  function openSheet(value: "buy" | "sell") { returnFocusRef.current = value === "buy" ? buyButtonRef.current : sellButtonRef.current; setActiveSide(value); setOpen(true); }
  function closeSheet() { setOpen(false); }
  async function prepareQuote(value: "buy" | "sell", amount: string): Promise<TradeQuote> {
    if (value === "buy" && amount !== "250") throw new Error("no-liquidity");
    if (value === "sell" && amount !== "0.005" && amount !== fixtureHolding) throw new Error("no-liquidity");
    if (value === "sell") return amount === fixtureHolding ? sellMaxQuote : sellPartialQuote;
    if (deferQuotes) return new Promise<TradeQuote>((resolve) => { resolveQuote.current = () => resolve(buyQuote); });
    if (nextQuote) return refreshedQuote;
    setNextQuote(true);
    return buyQuote;
  }
  return <Toaster>
    <TradeDetail availability={availability} stock={availability === "stock-not-yet-in-home"} onBuy={() => openSheet("buy")} onSell={() => openSheet("sell")} buyButtonRef={buyButtonRef} sellButtonRef={sellButtonRef} />
    <TradeSheet open={open} side={activeSide} available={available} reducedMotion={reducedMotion} timeZone="UTC" initialState={initialState}
      onClose={closeSheet} returnFocusRef={returnFocusRef} prepareQuote={prepareQuote} execute={async (quote) => {
        executions.current += 1;
        if (executions.current === 1 && executeError) throw executeError === "generic" ? new Error("unavailable") : new TransferExecutionError(executeError);
        if (deferExecution) await new Promise<void>(() => {});
        return { id: quote.action.id, status: rejectFirst && executions.current === 1 ? "rejected" : outcome };
      }} />
    {deferQuotes ? <Button onClick={() => { resolveQuote.current?.(); resolveQuote.current = null; }}>Resolve pending quote</Button> : null}
  </Toaster>;
}

function RtlDocument({ children }: { children: ReactNode }) {
  useEffect(() => {
    const previous = document.documentElement.getAttribute("dir");
    document.documentElement.dir = "rtl";
    return () => {
      if (previous === null) document.documentElement.removeAttribute("dir");
      else document.documentElement.dir = previous;
    };
  }, []);
  return children;
}

const meta = {
  id: "explorations-invest-trade",
  title: "Explorations/Invest Trade",
  component: TradeStory,
  args: { scene: "entry" },
  render: (args) => <TradeStory {...args} />,
  beforeEach: () => {
    const realNow = Date.now;
    const realStart = realNow();
    Date.now = () => Date.parse(fixtureNow) + (realNow() - realStart);
    return () => { Date.now = realNow; };
  },
  decorators: [(Story) => <><aside className="relative z-50 px-4 pt-2"><Badge variant="outline">Development fixtures</Badge></aside><Story /></>],
  parameters: { layout: "fullscreen", a11y: { test: "todo" } },
  globals: { viewport: { value: "mobile" } },
} satisfies Meta<typeof TradeStory>;
export default meta;
type Story = StoryObj<typeof meta>;

function entryPlay(text: string, buy: boolean, sell: boolean): Story["play"] {
  return async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(text)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Buy" }) !== null).toBe(buy);
    await expect(canvas.queryByRole("button", { name: "Sell" }) !== null).toBe(sell);
  };
}

function sheetPlay(title: string, facts: string[], cta: string): Story["play"] {
  return async ({ canvasElement }) => {
    const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: title });
    const dialog = within(sheet);
    for (const fact of facts) await expect(sheet).toHaveTextContent(fact);
    await expect(dialog.getByRole("button", { name: cta })).toBeVisible();
  };
}

export const EntryAvailable: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(/You have/)).toHaveTextContent("0.01234567 cbBTC");
  await expect(canvas.getByRole("button", { name: "Buy" })).toBeEnabled();
  await expect(canvas.getByRole("button", { name: "Sell" })).toBeEnabled();
} };
export const EntryNoHolding: Story = { args: { availability: "available-no-holding" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText("No Bitcoin to sell yet")).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Sell" })).toBeDisabled();
} };
export const EntrySignedOut: Story = { args: { availability: "signed-out" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("button", { name: "Sign in to continue" })).toBeVisible();
  await expect(canvas.queryByRole("button", { name: "Sell" })).not.toBeInTheDocument();
} };
export const EntryTemporarilyUnavailable: Story = { args: { availability: "temporarily-unavailable" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText("Home could not load trading.")).toBeVisible();
  await expect(canvas.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument();
  await expect(canvas.queryByRole("button", { name: "Sell" })).not.toBeInTheDocument();
  await expect(canvas.getByRole("button", { name: "Try again" })).toBeVisible();
} };
export const EntryNotSetUp: Story = { args: { availability: "not-set-up" }, play: entryPlay("This feature is not set up", false, false) };
export const EntryUnsupportedSigner: Story = { args: { availability: "unsupported-signer" }, play: entryPlay("Your wallet can't trade in Home yet.", false, false) };
export const EntryStockNotYetInHome: Story = { args: { availability: "stock-not-yet-in-home" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(canvas.getByRole("heading", { name: "Apple" })).toBeVisible(); await expect(canvas.getByText("Stock trading is not yet in Home.")).toBeVisible(); } };
export const EntryAvailableDesktop: Story = { globals: { viewport: { value: "desktop" } }, play: EntryAvailable.play };

export const BuyAmount: Story = { args: { scene: "sheet", initialState: { step: amountStep, amount: "" } }, play: sheetPlay("Buy Bitcoin", ["$999.95 available"], "Continue") };
export const BuyAmountPrecision: Story = { args: BuyAmount.args, play: async ({ canvasElement }) => {
  const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Buy Bitcoin" }));
  const input = dialog.getByRole("textbox", { name: "Amount" });
  await userEvent.type(input, "1.1234567");
  await expect(input).toHaveValue("1.123456");
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeEnabled();
} };
export const SellAmountPrecision: Story = { args: { scene: "sheet", side: "sell" }, play: async ({ canvasElement }) => {
  const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Sell Bitcoin" }));
  const input = dialog.getByRole("textbox", { name: "Amount" });
  await userEvent.type(input, "0.001234567");
  await expect(input).toHaveValue("0.00123456");
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeEnabled();
} };
export const BuyAmountLongValue: Story = { args: { scene: "sheet", available: "9876543.21", initialState: { step: amountStep, amount: "1234567.89" } }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Buy Bitcoin" });
  await expect(sheet).toHaveTextContent("$9,876,543.16 available");
  await expect(sheet.querySelector("[data-primary-amount]")).toHaveTextContent("$1234567.89");
  await expect(within(sheet).getByRole("button", { name: "Continue" })).toBeVisible();
} };
export const BuyAmountOverAvailable: Story = { args: { scene: "sheet", initialState: { step: amountStep, amount: "1000" } }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Buy Bitcoin" });
  const dialog = within(sheet);
  await expect(sheet).toHaveTextContent("Only $999.95 available");
  await expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeDisabled();
  await userEvent.click(dialog.getByRole("button", { name: "Max" }));
  await expect(sheet.querySelector("[data-primary-amount]")).toHaveTextContent("$999.95");
  await expect(sheet).not.toHaveTextContent("Only $999.95 available");
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeEnabled();
} };
function reviewPlay(hero: string, receive: string, cta: string, actionId: string): Story["play"] {
  return async ({ canvasElement }) => {
    const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
    const dialog = within(sheet);
    await expect(sheet).toHaveTextContent(hero);
    await expect(sheet).toHaveTextContent(receive);
    await expect(sheet).toHaveTextContent("Up to $0.05");
    await expect(dialog.getByRole("button", { name: cta })).toHaveAttribute("data-money-action-id", actionId);
    for (const text of ["Minimum received", "Swap fee", "Included in rate"]) await expect(sheet).not.toHaveTextContent(text);
  };
}
export const BuyReview: Story = { args: { scene: "sheet", initialState: { step: buyReview, amount: "250" } }, play: reviewPlay("$250.00", "≈ 0.00228125 cbBTC", "Buy $250.00", "fixture-buy") };
export const BuyReviewLongAmount: Story = { args: { scene: "sheet", initialState: { step: { name: "review", quote: {
  ...buyQuote,
  action: { ...buyQuote.action, amounts: buyQuote.action.amounts.map((entry) => entry.direction === "spend" ? { ...entry, amountBaseUnits: "123456789012123456" } : entry) },
} }, amount: "123456789012.123456" } }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  const amount = sheet.querySelector<HTMLElement>("[data-trade-amount]");
  if (!amount) throw new Error("Trade amount not found");
  await expect(amount).toHaveTextContent("$123,456,789,012.12");
  await expect(within(sheet).getByRole("button", { name: "Buy $123,456,789,012.12" })).toBeVisible();
  await waitFor(() => expect(amount.scrollWidth).toBeLessThanOrEqual(amount.clientWidth));
} };
export const BuyReviewDesktop: Story = { ...BuyReview, globals: { viewport: { value: "desktop" } } };
export const SellPartialReview: Story = { args: { scene: "sheet", side: "sell", initialState: { step: { name: "review", quote: sellPartialQuote }, amount: "0.005" } }, play: reviewPlay("0.005 cbBTC", "≈ $546.95", "Sell 0.005 cbBTC", "fixture-sell-partial") };
export const SellMaxReview: Story = { args: { scene: "sheet", side: "sell", initialState: { step: { name: "review", quote: sellMaxQuote }, amount: fixtureHolding } }, play: reviewPlay("0.01234567 cbBTC", "≈ $1,350.49", "Sell all Bitcoin", "fixture-sell-max") };
export const BuyReviewDetailsOpen: Story = { args: BuyReview.args, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  const dialog = within(sheet);
  await expect(dialog.queryByText("Minimum received")).not.toBeInTheDocument();
  const details = dialog.getByRole("button", { name: "Details" });
  await userEvent.click(details);
  await expect(details).toHaveAttribute("aria-expanded", "true");
  for (const text of ["250 USDC", "0.00226984 cbBTC", "1 cbBTC = 109,589.04 USDC", "0.5%", "12:04:30 PM UTC", "Up to 0.05 USDC", "Base", "0x3333"]) await expect(sheet).toHaveTextContent(text);
  for (const label of ["You pay", "Minimum received", "Rate", "Max slippage", "Quote valid until", "Network", "From"]) await waitFor(() => expect(dialog.getByText(label)).toBeVisible());
  await expect(dialog.getByText("Network").nextElementSibling).toHaveTextContent("Base");
  await expect(dialog.getAllByText("Network fee")).toHaveLength(2);
  await userEvent.click(details);
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await expect(dialog.queryByText("Minimum received")).not.toBeInTheDocument();
} };
export const SellPartialReviewDetailsOpen: Story = { args: SellPartialReview.args, play: async ({ canvasElement }) => {
  const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" }));
  await userEvent.click(dialog.getByRole("button", { name: "Details" }));
  await expect(dialog.getByText("Minimum received").nextElementSibling).toHaveTextContent("544.21 USDC");
  await expect(dialog.getAllByText("Network fee")[1].nextElementSibling).toHaveTextContent("Up to 0.05 USDC");
  await expect(dialog.getByText("Network").nextElementSibling).toHaveTextContent("Base");
} };
export const Signing: Story = { args: { scene: "sheet", initialState: { step: { name: "signing", quote: buyQuote }, amount: "250" } }, play: async ({ canvasElement }) => {
  const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" }));
  await expect(dialog.getByRole("button", { name: "Buy $250.00" })).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Details" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();
  await expect(dialog.queryByText("Waiting for your wallet…")).not.toBeInTheDocument();
} };
async function expectToast(document: Document, message: string, role: "status" | "alert" = "status") {
  const viewport = within(document.body).getByRole("region", { name: "Notifications" });
  await expect(viewport).toHaveAttribute("aria-live", "polite");
  const toast = await within(viewport).findByRole(role === "alert" ? "alertdialog" : "dialog", { hidden: role === "alert" });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveTextContent(message);
}

function toastPlay(cta: string, message: string, role: "status" | "alert", trigger: "Buy" | "Sell" = "Buy"): Story["play"] {
  return async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole("button", { name: trigger }));
    const dialog = within(await body.findByRole("dialog", { name: "Confirm" }));
    await userEvent.click(dialog.getByRole("button", { name: cta }));
    await waitFor(() => expect(body.queryByRole("dialog", { name: "Confirm" })).not.toBeInTheDocument());
    await expectToast(canvasElement.ownerDocument, message, role);
    await waitFor(() => expect(within(canvasElement).getByRole("button", { name: trigger })).toHaveFocus());
  };
}
export const ConfirmedToast: Story = { args: { ...BuyReview.args, scene: "entry" }, play: toastPlay("Buy $250.00", "Bought 0.00228190 cbBTC", "status") };
export const SubmittedToast: Story = { args: { ...BuyReview.args, scene: "entry", outcome: "submitted" }, play: toastPlay("Buy $250.00", "Buying $250.00 of Bitcoin", "status") };
export const UnknownToast: Story = { args: { ...BuyReview.args, scene: "entry", outcome: "unknown" }, play: toastPlay("Buy $250.00", "Can't confirm your trade yet. Check Activity before trying again.", "status") };
export const FailedToast: Story = { args: { ...BuyReview.args, scene: "entry", outcome: "failed" }, play: toastPlay("Buy $250.00", "Trade failed. Your $250.00 is still in Cash.", "alert") };
export const SoldToast: Story = { args: { ...SellPartialReview.args, scene: "entry" }, play: toastPlay("Sell 0.005 cbBTC", "Sold 0.005 cbBTC for $547.10", "status", "Sell") };
export const SellMaxSubmittedToast: Story = { args: { ...SellMaxReview.args, scene: "entry", outcome: "submitted" }, play: toastPlay("Sell all Bitcoin", "Selling all your Bitcoin", "status", "Sell") };
export const ExecutionSubmissionUnknown: Story = { args: { ...BuyReview.args, scene: "entry", executeError: "submission-unknown" }, play: toastPlay("Buy $250.00", "Can't confirm your trade yet. Check Activity before trying again.", "status") };
export const ExecutionConflict: Story = { args: { ...BuyReview.args, executeError: "submission-pending" }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  await userEvent.click(within(sheet).getByRole("button", { name: "Buy $250.00" }));
  await expect(within(sheet).getByRole("alert")).toHaveTextContent("Couldn't start your trade. Try again.");
  await expect(within(sheet).getByRole("button", { name: "Buy $250.00" })).toBeEnabled();
  await expect(within(canvasElement.ownerDocument.body).queryByText("Buying $250.00 of Bitcoin")).not.toBeInTheDocument();
} };
export const WalletRejected: Story = { args: { scene: "sheet", initialState: { step: { name: "wallet-rejected", quote: buyQuote }, amount: "250" } }, play: sheetPlay("Confirm", ["You declined in your wallet. Your review is still ready."], "Buy $250.00") };
export const QuoteExpired: Story = { args: { scene: "sheet", initialState: { step: { name: "quote-expired", quote: expiredQuote }, amount: "250" } }, play: sheetPlay("Confirm", ["This quote expired."], "Get new quote") };
export const ReviewRemainsMountedWhileSigning: Story = { args: { ...BuyReview.args, deferExecution: true }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  const summary = sheet.querySelector("[data-trade-amount]");
  if (!summary) throw new Error("Trade summary not found");
  await userEvent.click(within(sheet).getByRole("button", { name: "Buy $250.00" }));
  await expect(within(sheet).getByRole("button", { name: "Buy $250.00" })).toHaveAttribute("aria-busy", "true");
  await expect(summary.isConnected).toBe(true);
  await expect(sheet.querySelector("[data-trade-amount]")).toBe(summary);
} };
export const ExecutionUnavailable: Story = { args: { ...BuyReview.args, executeError: "unavailable" }, play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  const sheet = await body.findByRole("dialog", { name: "Confirm" });
  const dialog = within(sheet);
  await userEvent.click(dialog.getByRole("button", { name: "Details" }));
  await userEvent.click(dialog.getByRole("button", { name: "Buy $250.00" }));
  await expect(dialog.getByRole("alert")).toHaveTextContent("Couldn't start your trade. Try again.");
  await expect(sheet).toBeInTheDocument();
  await expect(dialog.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByRole("button", { name: "Buy $250.00" })).toBeEnabled();
  await expect(dialog.getAllByRole("button", { name: "Back" })[0]).toBeEnabled();
  await userEvent.click(dialog.getByRole("button", { name: "Buy $250.00" }));
  await waitFor(() => expect(body.queryByRole("dialog", { name: "Confirm" })).not.toBeInTheDocument());
  await expectToast(canvasElement.ownerDocument, "Bought 0.00228190 cbBTC");
} };
export const ExecutionStaleSession: Story = { args: { ...BuyReview.args, executeError: "stale-session" }, play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  const sheet = await body.findByRole("dialog", { name: "Confirm" });
  await userEvent.click(within(sheet).getByRole("button", { name: "Buy $250.00" }));
  await expect(within(sheet).getByRole("alert")).toHaveTextContent("Your session ended. Sign in again, then try again.");
  await expect(sheet).toBeInTheDocument();
  await expect(within(sheet).getByRole("button", { name: "Buy $250.00" })).toBeEnabled();
} };
export const ExecutionGenericFailure: Story = { args: { ...BuyReview.args, executeError: "generic" }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  await userEvent.click(within(sheet).getByRole("button", { name: "Buy $250.00" }));
  await expect(within(sheet).getByRole("alert")).toHaveTextContent("Couldn't start your trade. Try again.");
  await expect(sheet).toBeInTheDocument();
} };
export const ExecutionInsufficientBalance: Story = { args: { ...BuyReview.args, executeError: "insufficient-balance" }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  await userEvent.click(within(sheet).getByRole("button", { name: "Buy $250.00" }));
  const amountSheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Buy Bitcoin" });
  await expect(amountSheet.querySelector("[data-primary-amount]")).toHaveTextContent("$250");
  await expect(within(amountSheet).getByRole("alert")).toHaveTextContent("Your balance changed. Enter a new amount.");
} };
export const ExecutionRejected: Story = { args: { ...BuyReview.args, executeError: "rejected" }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  await userEvent.click(within(sheet).getByRole("button", { name: "Buy $250.00" }));
  await expect(within(sheet).getByRole("alert")).toHaveTextContent("You declined in your wallet. Your review is still ready.");
} };
export const ExecutionErrorExpires: Story = { args: { scene: "sheet", initialState: { step: { name: "execution-error", quote: expiredQuote, error: "unavailable" }, amount: "250" } }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  await waitFor(() => expect(within(sheet).getByRole("alert")).toHaveTextContent("This quote expired."));
  await expect(within(sheet).getByRole("button", { name: "Get new quote" })).toBeVisible();
} };
function createManualScheduler(start: number): ExpiryScheduler & { advance(ms: number): void } {
  let now = start;
  let nextId = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  return {
    now: () => now,
    setTimeout(callback, ms) {
      const id = ++nextId;
      timers.set(id, { due: now + ms, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > now) break;
        timers.delete(next[0]);
        next[1].callback();
      }
    },
  };
}

let expiryScheduler: ReturnType<typeof createManualScheduler> | undefined;
export const QuoteExpiresWhileOpen: Story = { args: { scene: "sheet" }, beforeEach: () => {
  expiryScheduler = createManualScheduler(Date.parse(fixtureValidUntil) - 50);
  return () => { expiryScheduler = undefined; };
}, render: (args) => {
  if (!expiryScheduler) throw new Error("Expiry scheduler not initialized");
  return <ExpirySchedulerContext value={expiryScheduler}><TradeStory {...args} initialState={{ step: { name: "review", quote: { ...buyQuote, action: { ...buyQuote.action, expiresAt: fixtureValidUntil } } }, amount: "250" }} /></ExpirySchedulerContext>;
}, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" });
  const dialog = within(sheet);
  await expect(dialog.getByRole("button", { name: "Buy $250.00" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Buy $250.00" })).toHaveAttribute("data-money-action-id", buyQuote.action.id);
  await expect(dialog.queryByText("This quote expired.")).not.toBeInTheDocument();
  await userEvent.click(dialog.getByRole("button", { name: "Details" }));
  await expect(dialog.getByText("Quote valid until").nextElementSibling).toHaveTextContent("12:04:30 PM UTC");
  await expect(dialog.getByText("Network").nextElementSibling).toHaveTextContent("Base");
  await waitFor(() => expect(dialog.getByText("Quote valid until")).toBeVisible());
  const scheduler = expiryScheduler;
  if (!scheduler) throw new Error("Expiry scheduler not initialized");
  await waitFor(async () => { scheduler.advance(51); await expect(dialog.getByText("This quote expired.")).toBeVisible(); });
  await expect(dialog.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByText("Quote valid until")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Get new quote" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Get new quote" })).not.toHaveAttribute("data-money-action-id");
} };
export const UnsupportedSignerAtQuote: Story = { args: { scene: "sheet", initialState: { step: { name: "amount", error: "unsupported-signer" }, amount: "250" } }, play: async ({ canvasElement }) => {
  const sheet = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Buy Bitcoin" });
  const dialog = within(sheet);
  await expect(dialog.getByRole("alert")).toHaveTextContent("Your wallet can't trade in Home yet.");
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeDisabled();
  const input = dialog.getByRole("textbox", { name: "Amount" });
  await userEvent.type(input, ".1");
  await expect(input).toHaveValue("250.1");
  await expect(sheet.querySelector("[data-primary-amount]")).toHaveTextContent("$250.1");
  await expect(dialog.getByRole("alert")).toHaveTextContent("Your wallet can't trade in Home yet.");
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeDisabled();
} };
export const NoLiquidity: Story = { args: { scene: "sheet", initialState: { step: { name: "amount", error: "no-liquidity" }, amount: "250" } }, play: sheetPlay("Buy Bitcoin", ["Not enough liquidity. Try a smaller amount."], "Continue") };
export const ProviderUnavailable: Story = { args: { scene: "sheet", initialState: { step: { name: "amount", error: "provider-unavailable" }, amount: "250" } }, play: sheetPlay("Buy Bitcoin", ["Couldn't get a quote. Try again."], "Try again") };
export const InsufficientBalance: Story = { args: { scene: "sheet", initialState: { step: { name: "amount", error: "insufficient-balance" }, amount: "250" } }, play: sheetPlay("Buy Bitcoin", ["Your balance changed. Enter a new amount."], "Continue") };
export const Convergence: Story = { args: { scene: "convergence" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const confirmed = canvas.getByRole("region", { name: "Confirmed" });
  await expect(within(confirmed).getByText("$749.97")).toBeVisible();
  await expect(within(confirmed).getByText("0.01462757 cbBTC")).toBeVisible();
  await expect(canvas.getByRole("region", { name: "Unknown" })).toHaveTextContent("Checking");
  await expect(canvas.getByRole("region", { name: "Pending" })).toHaveTextContent("≈ +0.00228125 cbBTC");
  await expect(confirmed).toHaveTextContent("$1,603.02");
  await expect(canvas.getByRole("region", { name: "Failed" })).toHaveTextContent("250 USDC");
} };
export const BuyJourney: Story = { play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Buy" }));
  let dialog = within(await body.findByRole("dialog", { name: "Buy Bitcoin" }));
  await userEvent.type(dialog.getByRole("textbox", { name: "Amount" }), "250");
  await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
  dialog = within(await body.findByRole("dialog", { name: "Confirm" }));
  await waitFor(() => expect(dialog.getByText("≈ 0.00228125 cbBTC")).toBeVisible());
  await expect(canvasElement.ownerDocument.activeElement).toHaveAccessibleName("Back");
  await expect(dialog.getByRole("button", { name: "Buy $250.00" })).toBeVisible();
  await userEvent.click(dialog.getByRole("button", { name: "Details" }));
  await userEvent.click(dialog.getAllByRole("button", { name: "Back" })[0]);
  const amountSheet = await body.findByRole("dialog", { name: "Buy Bitcoin" });
  dialog = within(amountSheet);
  await expect(amountSheet).toHaveTextContent("$250");
  await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
  dialog = within(await body.findByRole("dialog", { name: "Confirm" }));
  await expect(dialog.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(dialog.getByRole("button", { name: "Buy $250.00" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await expectToast(canvasElement.ownerDocument, "Bought 0.00228190 cbBTC");
  await waitFor(() => expect(within(canvasElement).getByRole("button", { name: "Buy" })).toHaveFocus());
} };

export const SellMaxJourney: Story = { play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Sell" }));
  let dialog = within(await body.findByRole("dialog", { name: "Sell Bitcoin" }));
  await userEvent.click(dialog.getByRole("button", { name: "Max" }));
  await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
  const review = await body.findByRole("dialog", { name: "Confirm" });
  dialog = within(review);
  await expect(review).toHaveTextContent("0.01234567 cbBTC");
  await expect(review).toHaveTextContent("≈ $1,350.49");
  await expect(review).toHaveTextContent("Sell all your Bitcoin");
  await userEvent.click(dialog.getByRole("button", { name: "Sell all Bitcoin" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await expectToast(canvasElement.ownerDocument, "Sold all your Bitcoin for $1,350.82");
} };
export const BackCloseReopen: Story = { play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Buy" }));
  let dialog = within(await body.findByRole("dialog", { name: "Buy Bitcoin" }));
  await userEvent.type(dialog.getByRole("textbox", { name: "Amount" }), "250");
  await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
  dialog = within(await body.findByRole("dialog", { name: "Confirm" }));
  await userEvent.click(dialog.getByRole("button", { name: "Details" }));
  await expect(dialog.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(dialog.getAllByRole("button", { name: "Back" })[0]);
  let amountSheet = await body.findByRole("dialog", { name: "Buy Bitcoin" });
  await expect(amountSheet.querySelector("[data-primary-amount]")).toHaveTextContent("$250");
  await userEvent.click(within(amountSheet).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Buy" }));
  amountSheet = await body.findByRole("dialog", { name: "Buy Bitcoin" });
  await expect(amountSheet.querySelector("[data-primary-amount]")).toHaveTextContent("$0");
  await userEvent.click(within(amountSheet).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Sell" }));
  const sellSheet = await body.findByRole("dialog", { name: "Sell Bitcoin" });
  await expect(sellSheet.querySelector("[data-primary-amount]")).toHaveTextContent("0 cbBTC");
  await userEvent.click(within(sellSheet).getByRole("button", { name: "Max" }));
  await userEvent.click(within(sellSheet).getByRole("button", { name: "Continue" }));
  const review = await body.findByRole("dialog", { name: "Confirm" });
  await userEvent.click(within(review).getByRole("button", { name: "Sell all Bitcoin" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await expectToast(canvasElement.ownerDocument, "Sold all your Bitcoin for $1,350.82");
} };
export const LateQuoteAfterClose: Story = { args: { deferQuotes: true }, play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Buy" }));
  const buy = within(await body.findByRole("dialog", { name: "Buy Bitcoin" }));
  await userEvent.type(buy.getByRole("textbox", { name: "Amount" }), "250");
  await userEvent.click(buy.getByRole("button", { name: "Continue" }));
  await expect(buy.getByRole("button", { name: "Getting quote…" })).toBeDisabled();
  await userEvent.click(buy.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await userEvent.click(canvas.getByRole("button", { name: "Resolve pending quote" }));
  await userEvent.click(canvas.getByRole("button", { name: "Sell" }));
  const sell = await body.findByRole("dialog", { name: "Sell Bitcoin" });
  await expect(sell.querySelector("[data-primary-amount]")).toHaveTextContent("0 cbBTC");
  await expect(body.queryByRole("dialog", { name: "Confirm" })).not.toBeInTheDocument();
  await userEvent.click(within(sell).getByRole("button", { name: "Max" }));
  await userEvent.click(within(sell).getByRole("button", { name: "Continue" }));
  const review = await body.findByRole("dialog", { name: "Confirm" });
  await userEvent.click(within(review).getByRole("button", { name: "Sell all Bitcoin" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await expectToast(canvasElement.ownerDocument, "Sold all your Bitcoin for $1,350.82");
} };
export const WalletRejectedRetry: Story = { args: { rejectFirst: true }, play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Buy" }));
  let dialog = within(await body.findByRole("dialog", { name: "Buy Bitcoin" }));
  await userEvent.type(dialog.getByRole("textbox", { name: "Amount" }), "250");
  await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
  dialog = within(await body.findByRole("dialog", { name: "Confirm" }));
  await userEvent.click(dialog.getByRole("button", { name: "Details" }));
  await userEvent.click(dialog.getByRole("button", { name: "Buy $250.00" }));
  const review = await body.findByRole("dialog", { name: "Confirm" });
  await expect(review).toHaveTextContent("You declined in your wallet. Your review is still ready.");
  await expect(within(review).getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
  await expect(review).toHaveTextContent("≈ 0.00228125 cbBTC");
  await userEvent.click(within(review).getByRole("button", { name: "Buy $250.00" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await expectToast(canvasElement.ownerDocument, "Bought 0.00228190 cbBTC");
} };
export const QuoteExpiredRefresh: Story = { args: QuoteExpired.args, play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  const expired = await body.findByRole("dialog", { name: "Confirm" });
  await userEvent.click(within(expired).getByRole("button", { name: "Details" }));
  await userEvent.click(within(expired).getByRole("button", { name: "Get new quote" }));
  const review = await body.findByRole("dialog", { name: "Confirm" });
  await expect(within(review).getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
  await expect(review).not.toHaveTextContent("Minimum received");
  await expect(review).toHaveTextContent("≈ 0.00228125 cbBTC");
  await expect(review).not.toHaveTextContent("This quote expired.");
  await userEvent.click(within(review).getByRole("button", { name: "Buy $250.00" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await expectToast(canvasElement.ownerDocument, "Bought 0.00228190 cbBTC");
} };
export const InterruptedTransition: Story = { play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Buy" }));
  let dialog = within(await body.findByRole("dialog", { name: "Buy Bitcoin" }));
  await userEvent.type(dialog.getByRole("textbox", { name: "Amount" }), "250");
  await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
  dialog = within(await body.findByRole("dialog", { name: "Confirm" }));
  await userEvent.click(dialog.getAllByRole("button", { name: "Back" })[0]);
  await userEvent.click(within(await body.findByRole("dialog", { name: "Buy Bitcoin" })).getByRole("button", { name: "Continue" }));
  const final = await body.findByRole("dialog", { name: "Confirm" });
  await expect(final).toHaveTextContent("≈ 0.00228125 cbBTC");
  await expect(body.getAllByRole("dialog")).toHaveLength(1);
  await userEvent.click(within(final).getByRole("button", { name: "Buy $250.00" }));
  await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await expectToast(canvasElement.ownerDocument, "Bought 0.00228190 cbBTC");
} };
export const ReducedMotion: Story = { ...BuyJourney, args: { reducedMotion: true }, play: async (context) => {
  await userEvent.click(within(context.canvasElement).getByRole("button", { name: "Buy" }));
  const body = within(context.canvasElement.ownerDocument.body);
  let dialog = within(await body.findByRole("dialog", { name: "Buy Bitcoin" }));
  await userEvent.type(dialog.getByRole("textbox", { name: "Amount" }), "250");
  await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
  dialog = within(await body.findByRole("dialog", { name: "Confirm" }));
  await userEvent.click(dialog.getByRole("button", { name: "Details" }));
  await waitFor(() => expect(dialog.getByText("Minimum received")).toBeVisible());
  await userEvent.click(dialog.getByRole("button", { name: "Buy $250.00" }));
  await waitFor(() => expect(context.canvasElement.ownerDocument.querySelector("[data-money-sheet]")).not.toBeInTheDocument());
  await expectToast(context.canvasElement.ownerDocument, "Bought 0.00228190 cbBTC");
} };
export const MotionReview: Story = {};
export const SellPartialReviewDesktop: Story = { ...SellPartialReview, globals: { viewport: { value: "desktop" } } };
export const NoLiquidityDesktop: Story = { ...NoLiquidity, globals: { viewport: { value: "desktop" } } };
export const NoLiquiditySmallMobile: Story = { ...NoLiquidity, globals: { viewport: { value: "smallMobile" } }, play: async ({ canvasElement }) => {
  const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Buy Bitcoin" }));
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveTextContent("Not enough liquidity. Try a smaller amount.");
  await expect(alert.scrollWidth).toBeLessThanOrEqual(alert.clientWidth);
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeDisabled();
} };
export const RtlReview: Story = { ...BuyReview, decorators: [(Story) => <RtlDocument><Story /></RtlDocument>], play: async (context) => {
  await BuyReview.play?.(context);
  const dialog = within(await within(context.canvasElement.ownerDocument.body).findByRole("dialog", { name: "Confirm" }));
  await userEvent.click(dialog.getByRole("button", { name: "Details" }));
  await waitFor(() => expect(dialog.getByText("Minimum received")).toBeVisible());
  await expect(context.canvasElement.ownerDocument.documentElement).toHaveAttribute("dir", "rtl");
} };
