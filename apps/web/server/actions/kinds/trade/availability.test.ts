import { readJson } from "@/tests/helpers/read-json";
import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BaseRpcError } from "@/server/chain/rpc";
import { resolveConvertPair } from "@/shared/currencies/convert";
import { CURRENCY_REGISTRY } from "@/shared/currencies/registry";
import { CONVERT_PROVIDER } from "@/shared/currencies/types";
import { TradePreparationError } from "./permit2";
import { createTradeAvailabilityHandler } from "./availability";
import { tradeBuyBlocked } from "./buy-policy";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const session: VerifiedAccountSession = {
  user: { subject: "owner" }, smartAccount: { address: ACCOUNT, chainId: 8453 }, accountProvider: "base-account",
};
const request = (assetId = "cbbtc") => new Request(`https://home.test/api/trades?assetId=${assetId}`);
const env = { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" };
const word = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;
const rpc = async (method: string, params: readonly unknown[]) => {
  if (method === "eth_chainId") return "0x2105";
  if (method === "eth_getCode") return "0x6000";
  const selector = (params[0] as { data: string }).data.slice(0, 10);
  return selector === "0x313ce567" ? word(8) : selector === "0x70a08231" ? word(7) : "0x";
};
const handler = (overrides: Parameters<typeof createTradeAvailabilityHandler>[0] = {}) => createTradeAvailabilityHandler({
  env, authorize: async () => session,
  resolveSigner: async () => ({ smartAccount: ACCOUNT, signerAddress: ACCOUNT, ownerIndex: 0, deployed: true }),
  rpc, ...overrides,
});

describe("trade availability", () => {
  test("returns private per-token availability and chain balance", async () => {
    const response = await handler()(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(await readJson(response)).toEqual({ version: 2, status: "available", buy: "available", balanceBaseUnits: "7",
      token: { assetId: "cbbtc", address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", symbol: "cbBTC", decimals: 8 } });
  });
  test.each(["pair", "not-pair", "check-failed"] as const)("checks exact-address %s before reading execution identity", async (kind) => {
    const address = "0x2222222222222222222222222222222222222222";
    let identityReads = 0;
    let pairReads = 0;
    const response = await handler({ rpc: async (method, params) => {
      if (method === "eth_call" && (params[0] as { data: string }).data === "0x0dfe1681") {
        pairReads++;
        expect(params).toEqual([{ to: address, data: "0x0dfe1681" }, "latest"]);
        if (kind === "check-failed") throw new BaseRpcError("offline", { code: "transport" });
        if (kind === "not-pair") throw new BaseRpcError("execution reverted", { code: "rpc", rpcCode: 3 });
        return `0x${"0".repeat(24)}${ACCOUNT.slice(2)}`;
      }
      if (method === "eth_getCode") identityReads++;
      return rpc(method, params);
    } })(request(`base:${address}`));
    const result = await readJson(response);
    expect(pairReads).toBe(1);
    if (kind === "not-pair") {
      expect(identityReads).toBe(1);
      expect(result).toMatchObject({ status: "available", token: { assetId: `base:${address}`, address } });
    } else {
      expect(identityReads).toBe(0);
      expect(result).toEqual({ version: 2, status: "unavailable", reason: kind === "pair" ? "asset-unsupported" : "chain-unavailable" });
    }
  });

  test.each(["usdc", "unknown", "nvda"]) ("rejects unsupported asset %s", async (assetId) => {
    expect(await readJson((await handler()(request(assetId))))).toEqual({ version: 2, status: "unavailable", reason: "asset-unsupported" });
  });
  test.each([
    ["provider-unconfigured", {}, session, false],
    ["account-unavailable", env, { ...session, smartAccount: null }, false],
    ["signer-unsupported", env, session, true],
  ] as const)("responds %s without leaking credentials", async (reason, credentials, active, unsupported) => {
    const response = await handler({ env: credentials, authorize: async () => active as VerifiedAccountSession,
      resolveSigner: async () => {
        if (unsupported) throw new TradePreparationError("signer-unsupported");
        return { smartAccount: ACCOUNT, signerAddress: ACCOUNT, ownerIndex: 0, deployed: true };
      } })(request());
    expect(await readJson(response)).toEqual({ version: 2, status: "unavailable", reason });
  });
  test.each([
    ["token-unreadable", async (method: string): Promise<string> => method === "eth_chainId" ? "0x2105" : "0x"],
    ["chain-unavailable", async () => { throw new BaseRpcError("offline", { code: "transport" }); }],
  ] as const)("reports %s", async (reason, failingRpc) => {
    expect(await readJson((await handler({ rpc: failingRpc })(request())))).toEqual({ version: 2, status: "unavailable", reason });
  });
  test("buy-only block retains sell availability", async () => {
    const removed = new Set(["cbbtc"]);
    expect(tradeBuyBlocked("cbbtc", removed)).toBe(true);
    expect(tradeBuyBlocked("cbxrp", removed)).toBe(false);
    expect(await readJson((await handler({ buyBlocked: (id) => tradeBuyBlocked(id, removed) })(request()))))
      .toMatchObject({ status: "available", buy: "blocked", balanceBaseUnits: "7" });
  });
  test("registry cash availability requires both verified directions", async () => {
    const record = CURRENCY_REGISTRY.find((entry) => entry.id === "base:eurc");
    if (!record) throw new Error("Missing EURC currency record.");
    const assetId = `base:${record.contractAddress.toLowerCase()}`;
    const noPair: typeof resolveConvertPair = (input) => resolveConvertPair(input, { pairs: [] });
    expect(await readJson(await handler({ convertPair: noPair })(request(assetId))))
      .toEqual({ version: 2, status: "unavailable", reason: "asset-unsupported" });
    for (const direction of ["sell", "buy"] as const) {
      const pair = { id: `eurc-${direction}`, from: direction === "sell" ? record.id : "base:usdc",
        to: direction === "sell" ? "base:usdc" : record.id, provider: CONVERT_PROVIDER,
        regions: "all" as const, status: "verified" as const, verifiedAt: "2026-09-28", evidence: "test fixture" };
      const convertPair: typeof resolveConvertPair = (input) => resolveConvertPair({ ...input, now: new Date("2026-09-28T12:00:00Z") }, { pairs: [pair] });
      expect(await readJson(await handler({ convertPair })(request(assetId))))
        .toEqual({ version: 2, status: "unavailable", reason: "asset-unsupported" });
    }
    const sell = { id: "eurc-sell", from: record.id, to: "base:usdc", provider: CONVERT_PROVIDER,
      regions: "all" as const, status: "verified" as const, verifiedAt: "2026-09-28", evidence: "test fixture" };
    const buy = { ...sell, id: "eurc-buy", from: sell.to, to: sell.from };
    const both: typeof resolveConvertPair = (input) => resolveConvertPair({ ...input, now: new Date("2026-09-28T12:00:00Z") }, { pairs: [sell, buy] });
    expect(await readJson(await handler({ convertPair: both })(request(assetId)))).toMatchObject({
      status: "available", buy: "available", token: { assetId, address: record.contractAddress },
    });
  });

  test("rejects the wrong RPC chain without claiming token availability", async () => {
    const wrongChain = handler({ rpc: async (method, params) => method === "eth_chainId" ? "0x1" : rpc(method, params) });
    expect(await readJson((await wrongChain(request())))).toEqual({ version: 2, status: "unavailable", reason: "chain-unavailable" });
  });
  test("preserves authentication denial", async () => {
    const denied = handler({ authorize: async () => Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }) });
    expect((await denied(request())).status).toBe(401);
  });
});
