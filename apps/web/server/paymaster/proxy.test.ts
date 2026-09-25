import { describe, expect, test } from "bun:test";
import { encodeFunctionData, erc20Abi, keccak256 } from "viem";
import { encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import type { ActionRow, ActionsStore } from "@/server/actions/store";
import { makePaymasterApproval } from "./fee";
import { createPaymasterProxyHandler } from "./proxy";

const id = "11111111-1111-4111-8111-111111111111";
const account = "0x1111111111111111111111111111111111111111";
const ep = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const epV07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const timestamp = Date.now();
const summary = { title: "Send", amounts: [], warnings: [], expiresAt: new Date(timestamp + 600000).toISOString(), networkFee: { payment: "usdc", token: usdc, paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", decimals: 6, maxFeeBaseUnits: "100000" } } satisfies ActionRow["summary"];
const calls = [
  makePaymasterApproval(BigInt(100000)),
  { to: usdc as `0x${string}`, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, BigInt(1000000)] }), value: "0" },
];
const callData = encodeCoinbaseExecuteBatch(calls);
const row = { owner_key: JSON.stringify(["user", account, 8453, "cdp-embedded"]), summary, created_at: new Date(timestamp).toISOString(), confirmed_at: new Date(timestamp).toISOString(), confirmed_call_data_hash: keccak256(callData) };
const result = { paymasterAndData: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c1234", tokenPayment: { address: usdc, maxFee: "0x186a0", decimals: 6, name: "USDC" } };

function call(options: { method?: string; sender?: string; callData?: unknown; chain?: number | string; row?: Pick<ActionRow, "owner_key" | "summary" | "created_at" | "confirmed_at" | "confirmed_call_data_hash"> | null; result?: unknown; now?: number; entryPoint?: string; id?: string } = {}) {
  let forwarded = 0;
  const handler = createPaymasterProxyHandler({
    store: { getForPaymaster: async () => options.row === undefined ? row : options.row } as unknown as ActionsStore,
    client: { request: async () => { forwarded++; return options.result ?? result; } } as never,
    now: () => options.now ?? timestamp,
  });
  const method = options.method ?? "pm_getPaymasterStubData";
  const params = method === "pm_getAcceptedPaymentTokens" ? [options.entryPoint ?? ep, options.chain ?? "0x2105", { sponsor: true }] : [{ sender: options.sender ?? account, ...(options.callData === null ? {} : { callData: options.callData ?? callData }) }, options.entryPoint ?? ep, options.chain ?? "0x2105", { sponsor: true }];
  const request = new Request("https://home.test/api/actions/123/paymaster", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }) });
  return { response: handler(request, { params: Promise.resolve({ id: options.id ?? id }) }), forwarded: () => forwarded };
}

describe("paymaster proxy", () => {
  test.each(["pm_getPaymasterStubData", "pm_getPaymasterData"])("passes a matching %s operation below the approved cap through", async (method) => {
    const { response, forwarded } = call({ method });
    const res = await response;
    expect(res.status).toBe(200);
    expect((await res.json()).result).toEqual(result);
    expect(forwarded()).toBe(1);
  });
  test("matches valid uppercase calldata by its lowercase bytes", async () => {
    const { response, forwarded } = call({ callData: `0x${callData.slice(2).toUpperCase()}` });
    expect((await response).status).toBe(200);
    expect(forwarded()).toBe(1);
  });
  test("passes provider's object-shaped USDC accepted tokens through unchanged", async () => {
    const accepted = { acceptedTokens: [{ name: "USDC", address: usdc }, { tokenAddress: usdc }], paymasterAddress: summary.networkFee.paymaster.toLowerCase() };
    const response = await call({ method: "pm_getAcceptedPaymentTokens", result: accepted }).response;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: accepted });
  });
  test.each([
    { acceptedTokens: [] },
    { acceptedTokens: [{ address: account }] },
    { acceptedTokens: [{ address: usdc }], paymasterAddress: account },
    [{ address: usdc }],
  ])("refuses invalid accepted-token results %j", async (accepted) => {
    const response = await call({ method: "pm_getAcceptedPaymentTokens", result: accepted }).response;
    expect(await response.json()).toMatchObject({ error: { message: "USDC payment is required." } });
  });
  test("wallet stub placeholders below the approval pass through", async () => {
    const stub = { ...result, tokenPayment: { ...result.tokenPayment, maxFee: "0x1" } };
    const response = await call({ result: stub }).response;
    expect(await response.json()).toMatchObject({ result: stub });
  });

  test.each([
    ["no confirmation (stub)", { row: { ...row, confirmed_at: null }, method: "pm_getPaymasterStubData" }],
    ["no confirmation (data)", { row: { ...row, confirmed_at: null }, method: "pm_getPaymasterData" }],
    ["no confirmation (tokens)", { row: { ...row, confirmed_at: null }, method: "pm_getAcceptedPaymentTokens" }],
    ["no commitment (stub)", { row: { ...row, confirmed_call_data_hash: null }, method: "pm_getPaymasterStubData" }],
    ["no commitment (tokens)", { row: { ...row, confirmed_call_data_hash: null }, method: "pm_getAcceptedPaymentTokens" }],
  ] as const)("rejects unconfirmed callback: %s", async (_, options) => {
    const { response, forwarded } = call(options);
    const res = await response;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "ACTION_NOT_CONFIRMED", message: "The action is not confirmed." } });
    expect(forwarded()).toBe(0);
  });
  test.each([
    ["mismatched", "0x1234"],
    ["missing", null],
    ["invalid hex", "0xzz"],
    ["different batch", encodeCoinbaseExecuteBatch([calls[0]!, { ...calls[1]!, value: "1" }])],
  ])("rejects %s operation calldata", async (_, invalidCallData) => {
    const { response, forwarded } = call({ callData: invalidCallData });
    const res = await response;
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_RPC", message: "The operation does not match the action." } });
    expect(forwarded()).toBe(0);
  });
  test.each([
    [{ sender: "0x2222222222222222222222222222222222222222" }, 400],
    [{ chain: "0x1" }, 400],
    [{ entryPoint: "0x2222222222222222222222222222222222222222" }, 400],
    [{ entryPoint: epV07 }, 400],
    [{ method: "pm_getAcceptedPaymentTokens", entryPoint: epV07 }, 400],
    [{ method: "eth_sendTransaction" }, 400],
    [{ row: { ...row, summary: { ...summary, networkFee: { payment: "native" } } } }, 404],
    [{ row: null }, 404],
    [{ now: timestamp + 1200001 }, 410],
    [{ id: "bad" }, 400],
  ] as const)("rejects invalid or unrelated callback %j", async (options, status) => {
    const { response, forwarded } = call(options);
    expect((await response).status).toBe(status);
    expect(forwarded()).toBe(0);
  });
  test.each([
    [{ paymasterAndData: result.paymasterAndData, tokenPayment: { ...result.tokenPayment, maxFee: "0x186a1" } }, "The network fee changed. Prepare the action again."],
    [{}, "USDC payment is required."],
    [{ tokenPayment: { ...result.tokenPayment, address: account } }, "USDC payment is required."],
  ] as const)("refuses a fee outside the action approval", async (upstream, message) => {
    const response = await call({ result: upstream }).response;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id: 2, error: { code: -32002, message } });
  });
});
