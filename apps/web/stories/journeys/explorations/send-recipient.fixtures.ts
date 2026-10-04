import { HttpResponse, http } from "msw";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";

export const ACCOUNT: `0x${string}` = "0x1111111111111111111111111111111111111111";
export const RECIPIENT: `0x${string}` = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9";
const OTHER: `0x${string}` = "0x2222222222222222222222222222222222222222";
export const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const recent = [{ address: RECIPIENT, name: "jesse.base.eth" }, { address: OTHER, name: null }];
const usdc = getTransferAsset("usdc");
if (!usdc) throw new Error("USDC transfer asset is required");
export const availableAssets = [{ ...usdc, balanceBaseUnits: "25000000", balanceLabel: "$25.00" }];
export type Mode = "default" | "name-loading" | "prepare-loading" | "providers-error" | "recent";

export function preparedAction(recipient: `0x${string}`): PreparedMoneyAction {
  return {
    id: ACTION_ID, kind: "send", title: "Send USDC",
    createdAt: "2099-09-12T12:00:00.000Z", expiresAt: "2099-09-12T12:10:00.000Z", calls: [],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
    warnings: [`Recipient: ${recipient}`],
    owner: { subject: "storybook-send-recipient", address: ACCOUNT, chainId: 8453, accountProvider: "cdp-embedded" },
  };
}

export function recipientResources(mode: Mode): AccountWalletClient["fetchAccountResource"] {
  return async (url) => {
    if (url.startsWith("/api/funding/providers")) {
      if (mode === "providers-error") throw new Error("Providers unavailable");
      return { version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [] };
    }
    if (url.startsWith("/api/funding/offramp/orders")) return { version: 3, recoveryEligible: false, orders: [] };
    if (url.startsWith("/api/transfers/recent-recipients")) return { version: 1, recipients: mode === "recent" ? recent : [] };
    if (url.startsWith("/api/actions/network-fee")) return { version: 1, usdcReserveBaseUnits: null };
    if (url.startsWith("/api/transfers/recipient-name")) {
      const name = new URL(url, "https://home.test").searchParams.get("name");
      if (name === "example.base.eth") {
        if (mode === "name-loading") return await new Promise<unknown>(() => {});
        return { version: 1, name, address: RECIPIENT };
      }
      throw Object.assign(new Error("Name unresolved"), { status: 404, code: "RECIPIENT_NAME_UNRESOLVED" });
    }
    throw new Error(`Unexpected account resource: ${url}`);
  };
}

export const sendRecipientHandlers = [
  ...["/api/funding/providers", "/api/funding/offramp/orders", "/api/transfers/recent-recipients", "/api/actions/network-fee", "/api/transfers/recipient-name"].map((path) =>
    http.get(path, async ({ request }) => {
      const path = request.url.replace(new URL(request.url).origin, "");
      if (path.startsWith("/api/transfers/recipient-name") && new URL(request.url).searchParams.get("name") !== "example.base.eth") {
        return HttpResponse.json({ code: "RECIPIENT_NAME_UNRESOLVED", error: "Name unresolved" }, { status: 404 });
      }
      return new HttpResponse(JSON.stringify(await recipientResources("recent")(path)), { headers: { "Content-Type": "application/json" } });
    })),
];
