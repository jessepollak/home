import { HttpResponse, http } from "msw";
import { createBlockedAccountWalletClient, type AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import { SUPPORT_CONTRACT_VERSION } from "@/shared/support/contract";
import { session } from "./savings-deposit.fixtures";

export const balance = presentBalances({
  status: "ready",
  snapshot: buildBalancesSnapshotFixture({
    region: "US",
    registry: { usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") } },
  }),
  error: null,
});

export async function fetchStoryResource(path: string, options?: { signal?: AbortSignal }): Promise<unknown> {
  const response = await fetch(path, { signal: options?.signal });
  if (!response.ok) throw new Error("Story resource unavailable");
  return response.json();
}

export const wallet: AccountWalletClient = {
  ...createBlockedAccountWalletClient("unconfigured"),
  isSignedIn: true,
  ownerKey: dataOwnerKey(session),
  status: "verified",
  verification: "server",
  session,
  fetchAccountResource: fetchStoryResource,
  fetchOperations: (signal) => fetchStoryResource("/api/actions", { signal }),
};

export const homeShellHandlers = [
  http.get("/api/support/summary", () => HttpResponse.json({ version: SUPPORT_CONTRACT_VERSION, unreadCount: 0 })),
  http.get("/api/actions", () => HttpResponse.json({ actions: [] })),
  http.get("https://api.ensideas.com/*", () => HttpResponse.json({ name: null, avatar: null })),
];
