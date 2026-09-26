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
const base = {
  id: "synthetic-trade", kind: "trade", provider: "cdp-embedded", status: "pending",
  createdAt: now, confirmedAt: now,
  summary: { title: "Trade", warnings: [], expiresAt: now,
    amounts: [
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1230000", direction: "spend" },
      { assetId: "cbbtc", symbol: "cbBTC", decimals: 8, amountBaseUnits: "1700", direction: "receive", estimated: true },
    ],
    metadata: { product: "trade", direction: "buy" },
  },
};

afterEach(() => { toast.close(); cleanup(); getHomeQueryClient().clear(); });

test("trade toasts use structured direction and exact spend rather than warnings", async () => {
  const key = ownerQueryKey(activityOwnerKey(session), "actions");
  const view = render(<ActionToasts session={session} fetchOperations={async () => ({ actions: [] })} dismissAfterMs={0} />);
  await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
  act(() => { getHomeQueryClient().setQueryData(key, { actions: [base] }); });
  await waitFor(() => expect(view.getByText("Buying Bitcoin for $1.23")).toBeTruthy());
  act(() => { getHomeQueryClient().setQueryData(key, { actions: [{ ...base, status: "confirmed" }] }); });
  await waitFor(() => expect(view.getByText("Bought Bitcoin for $1.23")).toBeTruthy());
});

test("sell toast presents exact Bitcoin spend, not estimated USDC receive", async () => {
  const key = ownerQueryKey(activityOwnerKey(session), "actions");
  const view = render(<ActionToasts session={session} fetchOperations={async () => ({ actions: [] })} dismissAfterMs={0} />);
  await waitFor(() => expect(getHomeQueryClient().getQueryData(key)).toBeTruthy());
  act(() => { getHomeQueryClient().setQueryData(key, { actions: [{ ...base, summary: {
    ...base.summary,
    metadata: { product: "trade", direction: "sell" },
    amounts: [
      { assetId: "cbbtc", symbol: "cbBTC", decimals: 8, amountBaseUnits: "50000", direction: "spend" },
      { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "350000", direction: "receive", estimated: true },
    ],
  } }] }); });
  await waitFor(() => expect(view.getByText("Selling 0.0005 BTC of Bitcoin")).toBeTruthy());
});
