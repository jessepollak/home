import { parseHash32, requireAddress } from "@/shared/chain/hex";
import type { CustomerDetailResponse, CustomerSearchResponse, CustomerSearchRow } from "@/shared/admin-customers/contract";

export const customerAdaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const customerNoEmailId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const customerReportedId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const conversationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const hash = (byte: string) => parseHash32(`0x${byte.repeat(32)}`);
const at = "2026-09-27T12:00:00.000Z";
const adaWallet = requireAddress("0x00000000000000000000000000000000000a11ce");

const ada: CustomerSearchRow = {
  customerId: customerAdaId, status: "active", merged: false, country: "US", firstSeenAt: "2026-09-01T09:00:00.000Z", firstSeenSource: "sign_in", lastSeenAt: at,
  signIn: ["cdp-embedded"], emails: [{ address: "ada@example.test", source: "cdp_verified" }], wallets: [adaWallet], walletCount: 1, funded: true,
};
const noEmail: CustomerSearchRow = {
  customerId: customerNoEmailId, status: "restricted", merged: false, country: null, firstSeenAt: "2026-08-15T09:00:00.000Z", firstSeenSource: "backfill", lastSeenAt: at,
  signIn: ["base-account"], emails: [], wallets: [requireAddress("0x00000000000000000000000000000000000b0b00")], walletCount: 1, funded: false,
};
const reported: CustomerSearchRow = {
  customerId: customerReportedId, status: "active", merged: false, country: "MX", firstSeenAt: "2026-08-01T09:00:00.000Z", firstSeenSource: "activity", lastSeenAt: at,
  signIn: ["base-account"], emails: [{ address: "grace@example.test", source: "wallet_reported" }], wallets: [], walletCount: 0, funded: false,
};

export const customerList: CustomerSearchResponse = { version: 1, match: "all", customers: [ada, noEmail, reported], nextCursor: null };
export const customerAdaMatch: CustomerSearchResponse = { version: 1, match: "email-or-order", customers: [ada], nextCursor: null };
export const customerNoMatch: CustomerSearchResponse = { version: 1, match: "email-or-order", customers: [], nextCursor: null };

export const customerAdaDetail: CustomerDetailResponse = {
  version: 1,
  profile: {
    customerId: customerAdaId, status: "active", mergedInto: null, country: "US", firstSeenAt: ada.firstSeenAt, firstSeenSource: "sign_in", lastSeenAt: at, deletionPending: false,
    credentials: [{ signIn: "cdp-embedded", email: { address: "ada@example.test", source: "cdp_verified" }, linkedVia: "first_use", firstSeenAt: ada.firstSeenAt, lastSeenAt: at }],
    wallets: [{ address: adaWallet, chainId: 8453, linkedAt: ada.firstSeenAt }],
  },
  balances: { status: "available", value: [{
    address: adaWallet,
    snapshot: {
      observedAt: at, stale: false, complete: true, currency: "USD", cash: "125.5", investments: "40", debt: "10", net: "155.5", netNegative: false,
      holdings: [
        { symbol: "USDC", name: "USD Coin", category: "cash", amount: "25.5", value: "25.5" },
        { symbol: "USDC", name: "Steakhouse USDC", category: "savings", amount: "100", value: "100" },
        { symbol: "cbBTC", name: "Coinbase Wrapped BTC", category: "collateral", amount: "0.0005", value: "40" },
      ],
      debts: [{ symbol: "USDC", amount: "10", value: "10" }],
    },
  }] },
  actions: { status: "available", value: { more: false, items: [
    { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", kind: "savings-deposit", title: "Save 100 USDC", createdAt: at, confirmedAt: at, status: "confirmed", outcome: "succeeded", transactionHash: hash("ab") },
    { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", kind: "send", title: "Send 5 USDC", createdAt: at, confirmedAt: at, status: "unknown", outcome: null, transactionHash: null },
  ] } },
  funding: { status: "available", value: { more: false, items: [
    { id: "12121212-1212-4121-8121-121212121212", providerId: "coinbase", region: "US", assetId: "usdc", fiatAmount: "150.00", state: "received", sandbox: false, createdAt: ada.firstSeenAt, updatedAt: at, providerOrderId: "CB-ORDER-1", transactionHash: hash("cd") },
  ] } },
  verification: { status: "available", value: [] },
  invites: { status: "available", value: { attributedCode: null, inviterCustomerId: null, ownCode: "abcdefghjk", attributedSignups: 2 } },
  support: { status: "available", value: { conversationId, status: "open", lastMessageAt: at } },
};

export const customerPartialDetail: CustomerDetailResponse = {
  ...customerAdaDetail,
  profile: { ...customerAdaDetail.profile, customerId: customerNoEmailId, credentials: [{ signIn: "base-account", email: null, linkedVia: "first_use", firstSeenAt: at, lastSeenAt: at }] },
  balances: { status: "unavailable" },
  actions: { status: "available", value: { more: false, items: [] } },
  funding: { status: "unavailable" },
  support: { status: "available", value: null },
};
