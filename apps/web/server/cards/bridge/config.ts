import "server-only";

import { createPublicKey } from "node:crypto";
import { getAddress, isAddress } from "viem";
import type { CardMode } from "../provider";

export type BridgeConfig = Readonly<{
  mode: CardMode;
  origin: "https://api.bridge.xyz" | "https://api.sandbox.bridge.xyz";
  chainId: 8453;
  token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  programSpender: `0x${string}`;
  webhookPublicKey: string;
  stripeApiVersion: string;
  stripeWebhookSecret: string;
}>;

export function readBridgeConfig(env: Readonly<Record<string, string | undefined>> = process.env): BridgeConfig | null {
  if (env.BRIDGE_ENABLED !== "1") return null;
  const mode = env.BRIDGE_MODE?.trim();
  if (mode !== "sandbox" && mode !== "production") throw new Error("Invalid Bridge mode");
  const publicKey = env.BRIDGE_WEBHOOK_PUBLIC_KEY?.trim();
  const stripeApiVersion = env.BRIDGE_STRIPE_API_VERSION?.trim();
  const stripeSecret = env.BRIDGE_STRIPE_WEBHOOK_SECRET?.trim();
  const spender = env.BRIDGE_PROGRAM_SPENDER?.trim();
  if (!publicKey || !stripeSecret || !spender || !stripeApiVersion) throw new Error("Missing Bridge configuration");
  const version = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:\.[a-z][a-z0-9]*)?$/.exec(stripeApiVersion);
  if (!version || Number.isNaN(Date.parse(`${version[1]}-${version[2]}-${version[3]}T00:00:00Z`)) ||
      new Date(`${version[1]}-${version[2]}-${version[3]}T00:00:00Z`).toISOString().slice(0, 10) !== `${version[1]}-${version[2]}-${version[3]}`) {
    throw new Error("Invalid Stripe API version");
  }
  try {
    const key = createPublicKey(publicKey.replaceAll("\\n", "\n"));
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
  } catch { throw new Error("Invalid Bridge webhook public key"); }
  if (!/^whsec_[A-Za-z0-9_-]{16,}$/.test(stripeSecret)) throw new Error("Invalid Stripe webhook secret");
  if (!isAddress(spender) || getAddress(spender) !== spender || /^0x(?:0{40}|f{40})$/i.test(spender)) {
    throw new Error("Invalid Bridge program spender");
  }
  return Object.freeze({
    mode,
    origin: mode === "sandbox" ? "https://api.sandbox.bridge.xyz" : "https://api.bridge.xyz",
    chainId: 8453,
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    programSpender: spender,
    webhookPublicKey: publicKey.replaceAll("\\n", "\n"),
    stripeApiVersion,
    stripeWebhookSecret: stripeSecret,
  });
}
