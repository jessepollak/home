import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { activityOwnerKey } from "@/client/activity/use-activity";
import { toast } from "@/components/ui/toast";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { ActionToasts } = await import("./action-toasts");
const session: VerifiedAccountSession = {
  user: { subject: "synthetic-toast-owner" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const now = "2026-09-15T12:00:00.000Z";
const usdc = { id: "usdc", symbol: "USDC", decimals: 6, address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
const degen = { id: "degen", symbol: "DEGEN", decimals: 18, address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed" };
const cbbtc = { id: "cbbtc", symbol: "cbBTC", decimals: 8, address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" };
const quoted = {
  product: "trade", provider: "cdp-swaps", network: { name: "Base", chainId: 8453 }, slippageBps: 100, fees: [],
  approval: "permit2-exact", quoteBlockNumber: "100", quotedAt: now, permitDeadline: "1790338500", executionDeadline: "1790338400",
};
const buyDegen = { ...quoted, direction: "buy", assetId: "degen", assetName: "Degen", fromAsset: usdc, toAsset: degen,
  fromAmountBaseUnits: "1230000", expectedToAmountBaseUnits: "1700000000000000000", minimumToAmountBaseUnits: "1683000000000000000" };
const base = {
  id: "synthetic-trade", kind: "trade", provider: "cdp-embedded", status: "pending",
  createdAt: now, confirmedAt: now,
  summary: { title: "Trade", warnings: [], expiresAt: now,
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1230000", direction: "spend" },
      { assetId: "degen", symbol: "DEGEN", decimals: 18, amountBaseUnits: "1700000000000000000", direction: "receive", estimated: true },
    ],
    metadata: buyDegen,
  },
};

afterEach(() => { toast.close(); cleanup(); getHomeQueryClient().clear(); });

test("trade toasts use metadata name and exact buy spend rather than warnings", async () => {
  const key = ownerQueryKey(activityOwnerKey(session), "actions");
  const view = render(<ActionToasts regionId="US" session={session} fetchOperations={async () => ({ actions: [] })} dismissAfterMs={0} />);
  await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
  act(() => { getHomeQueryClient().setQueryData(key, { actions: [base] }); });
  await waitFor(() => expect(view.getByText("Buying Degen for $1.23")).toBeTruthy());
  act(() => { getHomeQueryClient().setQueryData(key, { actions: [{ ...base, status: "confirmed" }] }); });
  await waitFor(() => expect(view.getByText("Bought Degen for $1.23")).toBeTruthy());
});

test("sell toast presents exact 18-decimal token spend, not estimated Cash receive", async () => {
  const key = ownerQueryKey(activityOwnerKey(session), "actions");
  const view = render(<ActionToasts regionId="US" session={session} fetchOperations={async () => ({ actions: [] })} dismissAfterMs={0} />);
  await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
  act(() => { getHomeQueryClient().setQueryData(key, { actions: [{ ...base, summary: {
    ...base.summary,
    metadata: { ...quoted, direction: "sell", assetId: "degen", assetName: "Degen", fromAsset: degen, toAsset: usdc,
      fromAmountBaseUnits: "500000000000000000", expectedToAmountBaseUnits: "350000", minimumToAmountBaseUnits: "346500" },
    amounts: [
      { assetId: "degen", symbol: "DEGEN", decimals: 18, amountBaseUnits: "500000000000000000", direction: "spend" },
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "350000", direction: "receive", estimated: true },
    ],
  } }] }); });
  await waitFor(() => expect(view.getByText("Selling 0.5 DEGEN of Degen")).toBeTruthy());
});

test("a legacy cbBTC trade without an asset name still gets its completion toast", async () => {
  const key = ownerQueryKey(activityOwnerKey(session), "actions");
  const view = render(<ActionToasts regionId="US" session={session} fetchOperations={async () => ({ actions: [] })} dismissAfterMs={0} />);
  await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
  const legacy = { ...base, summary: { ...base.summary,
    metadata: { ...quoted, direction: "buy", fromAsset: usdc, toAsset: cbbtc,
      fromAmountBaseUnits: "1230000", expectedToAmountBaseUnits: "1000", minimumToAmountBaseUnits: "990" },
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1230000", direction: "spend" },
      { assetId: "cbbtc", symbol: "cbBTC", decimals: 8, amountBaseUnits: "1000", direction: "receive", estimated: true },
    ] } };
  act(() => { getHomeQueryClient().setQueryData(key, { actions: [legacy] }); });
  await waitFor(() => expect(view.getByText("Buying Bitcoin for $1.23")).toBeTruthy());
  act(() => { getHomeQueryClient().setQueryData(key, { actions: [{ ...legacy, status: "confirmed" }] }); });
  await waitFor(() => expect(view.getByText("Bought Bitcoin for $1.23")).toBeTruthy());
});
