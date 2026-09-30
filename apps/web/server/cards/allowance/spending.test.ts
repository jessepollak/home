import "server-only";

import { describe, expect, test } from "bun:test";
import { encodeFunctionData, erc20Abi } from "viem";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { parseCardSpendingError, parseCardSpendingResponse } from "@/shared/cards/allowance-contract";
import type { CardAllowanceRegistry } from "./config";
import { createCardSpendingHandler } from "./spending";

const owner = "0x1111111111111111111111111111111111111111" as const;
const spender = "0x3333333333333333333333333333333333333333" as const;
const retiredSpender = "0x4444444444444444444444444444444444444444" as const;
const zeroRetiredSpender = "0x5555555555555555555555555555555555555555" as const;
const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: "owner" }, smartAccount: { address: owner, chainId: 8453 } };
const registry = { current: spender, maximumBaseUnits: "100000000", retired: [], bridge: { mode: "production" } } as unknown as CardAllowanceRegistry;
const fetchedAt = "2026-09-28T12:00:00.000Z";
const request = (signal?: AbortSignal) => new Request("http://localhost/api/cards/spending", { headers: { "X-Home-Account-Provider": "base-account" }, signal });
const word = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;
type Failure = "block" | "balance" | "allowance" | "retired" | "malformed" | "abort";
function handler(options: { balance?: number; allowance?: number; registry?: CardAllowanceRegistry | null;
  invalidRegistry?: boolean; enabled?: boolean; invalidJourney?: boolean; fail?: Failure; session?: VerifiedAccountSession | Response; retiredAllowance?: number } = {},
  calls: Array<{ method: string; params: readonly unknown[]; signal?: AbortSignal }> = []) {
  return createCardSpendingHandler({
    authorize: async () => options.session ?? session,
    registry: () => { if (options.invalidRegistry) throw new Error("invalid settings"); return options.registry === undefined ? registry : options.registry; },
    journey: () => { if (options.invalidJourney) throw new Error("invalid journey"); return options.enabled === false ? null : ({ mode: "production", funding: { kind: "crypto_wallet" } }) as ReturnType<typeof import("../bridge/journey-config").readCardJourneyConfig>; },
    now: () => fetchedAt,
    rpc: async (method, params, rpcOptions) => {
      calls.push({ method, params, signal: rpcOptions?.signal });
      if (method === "eth_blockNumber") {
        if (options.fail === "block") throw new Error("block unavailable");
        return "0x64";
      }
      const data = (params[0] as { data: string }).data;
      const balance = data.startsWith("0x70a08231");
      const retiredRead = data === encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, retiredSpender] });
      const zeroRetiredRead = data === encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, zeroRetiredSpender] });
      if (options.fail === (balance ? "balance" : retiredRead ? "retired" : "allowance")) throw new Error("call unavailable");
      if (options.fail === "abort") rpcOptions?.signal?.throwIfAborted();
      if (options.fail === "malformed" && !balance) return "0xbad";
      return word(balance ? (options.balance ?? 10) : zeroRetiredRead ? 0 : retiredRead ? (options.retiredAllowance ?? 25) : (options.allowance ?? 5));
    },
  });
}

const available = (walletBaseUnits: string, allowanceBaseUnits: string, availableBaseUnits: string) => ({
  version: 1 as const, status: "available" as const, setEnabled: true, spender, walletBaseUnits, allowanceBaseUnits, availableBaseUnits, retired: [], blockNumber: "100", fetchedAt,
});

describe("GET /api/cards/spending", () => {
  test.each([[10, 5, "5"], [5, 10, "5"], [0, 0, "0"]] as const)("reports min(%i,%i) and pins both calls to one block", async (balance, allowance, minimum) => {
    const calls: Array<{ method: string; params: readonly unknown[]; signal?: AbortSignal }> = [];
    const result = await handler({ balance, allowance }, calls)(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(await result.json()).toEqual(available(String(balance), String(allowance), minimum));
    expect(calls.map(({ method }) => method)).toEqual(["eth_blockNumber", "eth_call", "eth_call"]);
    expect(calls.slice(1).map(({ params }) => params)).toEqual([
      [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }) }, "0x64"],
      [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, spender] }) }, "0x64"],
    ]);
    expect(calls.every(({ signal }) => signal === calls[0]?.signal && signal instanceof AbortSignal)).toBe(true);
  });
  test("retired spender allowances are returned at the pinned block but excluded from available", async () => {
    const calls: Array<{ method: string; params: readonly unknown[]; signal?: AbortSignal }> = [];
    const withRetired = { ...registry, retired: [retiredSpender, zeroRetiredSpender] };
    const result = await handler({ registry: withRetired, retiredAllowance: 25 }, calls)(request());
    expect(await result.json()).toEqual({ ...available("10", "5", "5"), retired: [
      { spender: retiredSpender, allowanceBaseUnits: "25" }, { spender: zeroRetiredSpender, allowanceBaseUnits: "0" }] });
    expect(calls[3]?.params).toEqual([{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, retiredSpender] }) }, "0x64"]);
    expect(calls[3]?.signal).toBe(calls[0]?.signal);
    expect(calls[4]?.params).toEqual([{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, zeroRetiredSpender] }) }, "0x64"]);
    expect(calls[4]?.signal).toBe(calls[0]?.signal);
    expect(await (await handler({ registry: withRetired, fail: "retired" })(request())).json()).toEqual({ version: 1, status: "unavailable", fetchedAt });
  });
  test("missing Bridge registry returns not-configured without a chain read", async () => {
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    expect(await (await handler({ registry: null }, calls)(request())).json()).toEqual({ version: 1, status: "not-configured" });
    expect(calls).toEqual([]);
  });
  test.each([{ enabled: false }, { registry: { ...registry, maximumBaseUnits: null } },
    { registry: { ...registry, bridge: { mode: "sandbox" } as CardAllowanceRegistry["bridge"] } }])("disabled set gate still reads allowance and returns setEnabled false", async (settings) => {
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    expect(await (await handler(settings, calls)(request())).json()).toEqual({ ...available("10", "5", "5"), setEnabled: false });
    expect(calls.map(({ method }) => method)).toEqual(["eth_blockNumber", "eth_call", "eth_call"]);
  });
  test("unreadable journey leaves allowance discovery available with setting disabled", async () => {
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    expect(await (await handler({ invalidJourney: true }, calls)(request())).json()).toEqual({ ...available("10", "5", "5"), setEnabled: false });
    expect(calls.map(({ method }) => method)).toEqual(["eth_blockNumber", "eth_call", "eth_call"]);
  });
  test("disabled set gate still discovers retired permissions for revocation", async () => {
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const result = await handler({ enabled: false, registry: { ...registry, retired: [retiredSpender] }, retiredAllowance: 25 }, calls)(request());
    expect(await result.json()).toEqual({ ...available("10", "5", "5"), setEnabled: false, retired: [{ spender: retiredSpender, allowanceBaseUnits: "25" }] });
    expect(calls.map(({ method }) => method)).toEqual(["eth_blockNumber", "eth_call", "eth_call", "eth_call"]);
  });
  test.each([{ invalidRegistry: true }, { fail: "block" as const }, { fail: "balance" as const },
    { fail: "allowance" as const }, { fail: "malformed" as const }])("unreadable values return unavailable, never zero", async (settings) => {
    const response = await handler(settings)(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, status: "unavailable", fetchedAt });
  });
  test("aborted request does not return stale values", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await (await handler({ fail: "abort" })(request(controller.signal))).json()).toEqual({ version: 1, status: "unavailable", fetchedAt });
  });
  test("deadline expiring during chain reads yields unavailable even if the RPC returns data", async () => {
    const controller = new AbortController();
    const GET = createCardSpendingHandler({ authorize: async () => session, registry: () => registry,
      journey: () => ({ mode: "production", funding: { kind: "crypto_wallet" } }) as ReturnType<typeof import("../bridge/journey-config").readCardJourneyConfig>,
      deadline: () => controller.signal, now: () => fetchedAt,
      rpc: async (method) => { if (method === "eth_blockNumber") return "0x64"; controller.abort(); return word(10); } });
    expect(await (await GET(request())).json()).toEqual({ version: 1, status: "unavailable", fetchedAt });
  });
  test("authentication fails with the same 401, without reading configuration", async () => {
    let touched = false;
    const authError = { error: { code: "UNAUTHENTICATED", message: "A valid access token is required." } };
    const GET = createCardSpendingHandler({ authorize: async () => Response.json(authError, { status: 401 }),
      registry: () => { touched = true; return registry; } });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(authError);
    expect(touched).toBe(false);
  });
  test("a verified session without a smart account cannot read any wallet", async () => {
    const calls: Array<{ method: string; params: readonly unknown[] }> = [];
    const response = await handler({ session: { ...session, accountProvider: "cdp-embedded", smartAccount: null } }, calls)(
      new Request("http://localhost/api/cards/spending"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ version: 1, error: { code: "CARDS_UNAVAILABLE" } });
    expect(parseCardSpendingError(body)).toEqual(body);
    expect(calls).toEqual([]);
  });
  test("successful response parses as a card spending contract", async () => {
    const value = await (await handler()(request())).json();
    expect(parseCardSpendingResponse(value)).toEqual(available("10", "5", "5"));
  });
});
