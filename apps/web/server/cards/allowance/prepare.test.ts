import "server-only";

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { encodeFunctionData, erc20Abi } from "viem";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import type { CardsResponse, CardState } from "@/shared/cards/contract";
import { readCardAllowanceRegistry, type CardAllowanceRegistry } from "./config";
import { createCardAllowancePreparation } from "./prepare";

const owner = "0x1111111111111111111111111111111111111111" as const;
const spender = "0x65bf8b55EEDef53C094E40003a03390De744DF33" as const;
const retired = "0x3333333333333333333333333333333333333333" as const;
const session: VerifiedAccountSession = { user: { subject: "customer" }, smartAccount: { address: owner, chainId: 8453 }, accountProvider: "cdp-embedded" };
const env = { BRIDGE_ENABLED: "1", BRIDGE_MODE: "production", BRIDGE_STRIPE_API_VERSION: "2026-08-27.basil",
  BRIDGE_WEBHOOK_PUBLIC_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString(),
  BRIDGE_STRIPE_WEBHOOK_SECRET: "whsec_synthetic_private_fixture", BRIDGE_PROGRAM_SPENDER: spender,
  BRIDGE_PROGRAM_RETIRED_SPENDERS: retired, BRIDGE_CARD_ALLOWANCE_MAX_USDC: "100" };
const baseRegistry = readCardAllowanceRegistry(env)!;
const set = { version: 1, operation: "set", allowanceBaseUnits: "25000000" };
const revoke = { version: 1, operation: "revoke", spender };
function state(status: CardState = "active"): CardsResponse {
  return { version: 1, state: status, cards: [{ id: "ic_test", status: status === "frozen" ? "frozen" : status === "canceled" ? "canceled" : status === "restricted" ? "restricted" : "active", last4: "4242" }],
    provenance: { bridge: "available", stripe: "available", fetchedAt: "2026-09-28T12:00:00.000Z" } };
}
type Overrides = {
  registry?: CardAllowanceRegistry | null;
  mode?: "sandbox" | "production";
  funding?: string;
  enabled?: boolean;
  customer?: boolean;
  customerWallet?: boolean;
  wallet?: string;
  cardState?: CardState;
  chain?: "failure" | "deadline" | "unchanged" | "already-zero";
};
function service(overrides: Overrides = {}, observed: Array<{ method: string; params: readonly unknown[]; signal: AbortSignal | undefined }> = []) {
  return createCardAllowancePreparation({
    registry: () => overrides.registry === undefined ? baseRegistry : overrides.registry,
    journey: () => overrides.enabled === false ? null : ({ mode: overrides.mode ?? "production", funding: { kind: overrides.funding ?? "crypto_wallet" } }) as ReturnType<typeof import("../bridge/journey-config").readCardJourneyConfig>,
    customer: async () => overrides.customer === false ? null : { id: "customer-1", walletId: overrides.customerWallet === false ? null : "wallet-1" },
    account: async () => ({ bridgeCustomerId: "bridge-1", stripeCardholderId: "ich_test", cards: [{ id: "card-1", stripeCardId: "ic_test", walletAddress: overrides.wallet ?? owner }] }),
    state: async () => state(overrides.cardState),
    rpc: async (method, params, options) => {
      observed.push({ method, params, signal: options?.signal });
      if (overrides.chain === "failure") throw new Error("RPC unavailable");
      if (overrides.chain === "deadline") {
        options?.signal?.throwIfAborted();
        throw new Error("RPC deadline exceeded");
      }
      return method === "eth_blockNumber" ? "0x64" : `0x${(overrides.chain === "unchanged" ? BigInt(25_000_000) : overrides.chain === "already-zero" ? BigInt(0) : BigInt(5_000_000)).toString(16).padStart(64, "0")}`;
    },
  });
}
async function refusal(overrides: Overrides, code: string, input: unknown = set) {
  await expect(service(overrides)(session, input)).rejects.toMatchObject({ code });
}

describe("card allowance preparation", () => {
  test("sets from a pinned allowance read and never records an allowance as spent funds", async () => {
    const calls: Array<{ method: string; params: readonly unknown[]; signal: AbortSignal | undefined }> = [];
    const draft = await service({}, calls)(session, set);
    expect(draft.kind).toBe("card-allowance");
    expect(draft.amounts).toEqual([]);
    expect(draft.metadata).toMatchObject({ operation: "set-allowance", allowanceBaseUnits: "25000000", previousAllowanceBaseUnits: "5000000", maximumBaseUnits: "100000000", source: { blockNumber: "100" } });
    expect(draft.calls).toEqual([{ to: BASE_USDC_ADDRESS, value: "0", approval: { assetId: "usdc", spender: spender.toLowerCase() as `0x${string}` },
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, BigInt(25_000_000)] }) }]);
    expect(calls[0]?.method).toBe("eth_blockNumber");
    expect(calls[1]?.params).toEqual([{ to: BASE_USDC_ADDRESS,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, spender.toLowerCase() as `0x${string}`] }) }, "0x64"]);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.signal).toBe(calls[1]?.signal);
  });
  test("accepts a frozen card", async () => {
    expect((await service({ cardState: "frozen" })(session, set)).metadata).toMatchObject({ product: "card" });
  });
  test.each(["sandbox", "financial_account", "missing-max", "missing-customer", "missing-wallet-link", "wallet-mismatch", "restricted", "canceled", "unavailable", "no-registry", "journey-disabled"] as const)("fails closed when set gate %s is absent", async (gate) => {
    const overrides: Overrides = gate === "sandbox" ? { mode: "sandbox" } : gate === "financial_account" ? { funding: "financial_account" } :
      gate === "missing-max" ? { registry: { ...baseRegistry, maximumBaseUnits: null } } : gate === "missing-customer" ? { customer: false } :
      gate === "missing-wallet-link" ? { customerWallet: false } :
      gate === "wallet-mismatch" ? { wallet: "0x2222222222222222222222222222222222222222" } : gate === "no-registry" ? { registry: null } :
      gate === "journey-disabled" ? { enabled: false } : { cardState: gate };
    await refusal(overrides, gate === "missing-customer" || gate === "missing-wallet-link" || gate === "wallet-mismatch" || gate === "restricted" || gate === "canceled" ? "CARD_ALLOWANCE_NOT_READY" : "CARD_ALLOWANCE_UNAVAILABLE");
  });
  test.each(["0", "100000001", "not-a-number"])("refuses invalid set amount %s", async (allowanceBaseUnits) => {
    await refusal({}, "CARD_ALLOWANCE_INVALID", { ...set, allowanceBaseUnits });
  });
  test.each(["failure", "deadline"] as const)("does not issue on %s allowance read", async (chain) => {
    await refusal({ chain }, "CARD_ALLOWANCE_UNAVAILABLE");
  });
  test("an aborted set stops before eligibility customer or provider reads", async () => {
    const controller = new AbortController();
    controller.abort();
    const called: string[] = [];
    const prepare = createCardAllowancePreparation({ registry: () => baseRegistry,
      journey: () => ({ mode: "production", funding: { kind: "crypto_wallet" } }) as ReturnType<typeof import("../bridge/journey-config").readCardJourneyConfig>,
      customer: async () => { called.push("customer"); return { id: "customer-1", walletId: "wallet-1" }; },
      account: async () => { called.push("account"); return null; },
      state: async () => { called.push("provider"); return state(); },
      rpc: async () => { called.push("rpc"); return "0x64"; },
    });
    await expect(prepare(session, set, controller.signal)).rejects.toMatchObject({ code: "CARD_ALLOWANCE_UNAVAILABLE" });
    expect(called).toEqual([]);
  });
  test("customer lookup receives the request signal and an abort makes eligibility unavailable", async () => {
    const controller = new AbortController();
    const received: Array<AbortSignal | undefined> = [];
    const calls: string[] = [];
    const prepare = createCardAllowancePreparation({ registry: () => baseRegistry,
      journey: () => ({ mode: "production", funding: { kind: "crypto_wallet" } }) as ReturnType<typeof import("../bridge/journey-config").readCardJourneyConfig>,
      customer: async (_session, signal) => { received.push(signal); controller.abort(); return { id: "customer-1", walletId: "wallet-1" }; },
      account: async () => { calls.push("account"); return null; },
      state: async () => { calls.push("provider"); return state(); },
      rpc: async () => { calls.push("rpc"); return "0x64" },
    });
    await expect(prepare(session, set, controller.signal)).rejects.toMatchObject({ code: "CARD_ALLOWANCE_UNAVAILABLE" });
    expect(received).toEqual([controller.signal]);
    expect(calls).toEqual([]);
  });
  test("aborted request fails the allowance read closed", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(service()(session, set, abort.signal)).rejects.toMatchObject({ code: "CARD_ALLOWANCE_UNAVAILABLE" });
  });
  test("rejects unchanged set and already-zero revoke", async () => {
    await refusal({ chain: "unchanged" }, "CARD_ALLOWANCE_UNCHANGED");
    await refusal({ chain: "already-zero" }, "CARD_ALLOWANCE_UNCHANGED", revoke);
  });
  test("revoke works for current and retired spender while journey disabled", async () => {
    expect((await service({ enabled: false })(session, revoke)).metadata).toMatchObject({ operation: "revoke-allowance", maximumBaseUnits: null });
    expect((await service({ enabled: false, mode: "sandbox" })(session, { ...revoke, spender: retired })).calls[0]?.approval?.spender).toBe(retired);
    const sandbox = await service({ enabled: false, registry: { ...baseRegistry, bridge: { ...baseRegistry.bridge, mode: "sandbox" } } })(session, revoke);
    expect(sandbox.metadata).toMatchObject({ mode: "sandbox" });
  });
  test("retired spender revoke review names only the permission being removed", async () => {
    const draft = await service({ enabled: false })(session, { ...revoke, spender: retired });
    expect(draft.title).toBe("Remove card spending permission");
    expect(draft.warnings).toEqual([`Removes this card program spender's (${retired}) permission to spend USDC from Cash. Other spenders keep their permissions.`]);
  });
  test("refuses an unknown revoke spender and unreadable revoke allowance", async () => {
    await refusal({}, "CARD_ALLOWANCE_INVALID", { ...revoke, spender: "0x2222222222222222222222222222222222222222" });
    await refusal({ enabled: false, chain: "failure" }, "CARD_ALLOWANCE_UNAVAILABLE", revoke);
  });
});
