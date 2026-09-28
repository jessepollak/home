import "server-only";

import type { CardMode } from "../provider";

export type CardJourneyConfig = Readonly<{
  mode: CardMode;
  bridgeOrigin: string;
  bridgeApiKey: string;
  stripeSecretKey: string;
  stripeApiVersion: string;
  funding: Readonly<{ kind: "crypto_wallet" } | { kind: "financial_account"; financialAccount: string }>;
}>;

export function readCardJourneyConfig(env: Readonly<Record<string, string | undefined>> = process.env): CardJourneyConfig | null {
  if (env.BRIDGE_ENABLED !== "1") return null;
  const mode = env.BRIDGE_MODE?.trim();
  if (mode !== "sandbox" && mode !== "production") throw new Error("Invalid Bridge mode");
  const bridgeApiKey = env.BRIDGE_API_KEY?.trim();
  const stripeSecretKey = env.BRIDGE_STRIPE_SECRET_KEY?.trim();
  const stripeApiVersion = env.BRIDGE_STRIPE_API_VERSION?.trim();
  const funding = env.BRIDGE_STRIPE_CARD_FUNDING?.trim();
  if (!bridgeApiKey || !stripeSecretKey || !stripeApiVersion) throw new Error("Missing card journey credentials or Stripe API version");
  const expectedPrefix = mode === "sandbox" ? "sk_test_" : "sk_live_";
  if (!stripeSecretKey.startsWith(expectedPrefix) || stripeSecretKey.length <= expectedPrefix.length) throw new Error("Stripe key does not match Bridge mode");
  const date = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:\.[a-z][a-z0-9]*)?$/.exec(stripeApiVersion);
  if (!date || Number.isNaN(Date.parse(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`)) ||
      new Date(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`).toISOString().slice(0, 10) !== `${date[1]}-${date[2]}-${date[3]}`) throw new Error("Invalid Stripe API version");
  if (funding !== "crypto_wallet" && funding !== "financial_account") throw new Error("Invalid card funding strategy");
  if (mode === "production" && funding !== "crypto_wallet") throw new Error("Production cards require crypto_wallet funding");
  const financialAccount = env.BRIDGE_STRIPE_FINANCIAL_ACCOUNT?.trim();
  if (funding === "financial_account" && !financialAccount) throw new Error("Missing sandbox Stripe financial account");
  if (funding === "crypto_wallet" && financialAccount) throw new Error("Unexpected Stripe financial account");
  let bridgeOrigin = mode === "sandbox" ? "https://api.sandbox.bridge.xyz" : "https://api.bridge.xyz";
  if (env.BRIDGE_API_BASE_URL?.trim()) {
    const override = env.BRIDGE_API_BASE_URL.trim();
    let url: URL;
    try { url = new URL(override); } catch { throw new Error("Invalid Bridge local URL"); }
    if (mode !== "sandbox" || url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Bridge override requires sandbox loopback origin");
    bridgeOrigin = url.origin;
  }
  return Object.freeze({ mode, bridgeOrigin, bridgeApiKey, stripeSecretKey, stripeApiVersion,
    funding: funding === "financial_account" ? { kind: "financial_account" as const, financialAccount: financialAccount! } : { kind: "crypto_wallet" as const } });
}
