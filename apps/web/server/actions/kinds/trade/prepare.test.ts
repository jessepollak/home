import { afterEach, describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeFunctionData, erc20Abi, hashTypedData, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import type { Address, Hex } from "@/shared/trading/server-types";
import { PERMIT2_ADDRESS, TradePreparationError } from "./permit2";
import { CdpSwapsUnavailableError, type SwapQuote } from "./cdp-swaps";
import { prepareTradeAction, tradePreparationResponse } from "./prepare";
import { makePaymasterApproval } from "@/server/paymaster/fee";
import { setActionsStoreForTests, type ActionsStore } from "@/server/actions/store";
import { issueMoneyAction } from "@/server/money-actions/issue";
import { createPrepareActionHandler } from "@/server/actions/prepare";
import { swapTokens, type SwapReviewRequest } from "./quote";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const ROUTER = "0x3333333333333333333333333333333333333333" as Address;
const makerAccount = privateKeyToAccount(`0x${"12".repeat(32)}`);
const POOL = makerAccount.address.toLowerCase() as Address;
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, "0");
const addr = (value: Address) => word(BigInt(value));
const input = (direction: "buy" | "sell"): SwapReviewRequest => ({ direction, fromAmount: BigInt(1_000_000), taker: OWNER, slippageBps: 100 });
const sessions = (provider: "base-account" | "cdp-embedded" = "cdp-embedded"): VerifiedAccountSession => ({
  user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: provider,
});
async function quoteFor(request: SwapReviewRequest, nonce = BigInt(4), makerDeadline?: bigint, invalidMakerSig = false): Promise<Extract<SwapQuote, { liquidityAvailable: true }>> {
  const { fromToken, toToken } = swapTokens(request.direction);
  const deadline = Math.floor(NOW.getTime() / 1000) + 90;
  const eip712 = {
    domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    }, primaryType: "PermitTransferFrom",
    message: { permitted: { token: fromToken, amount: request.fromAmount.toString() }, spender: ROUTER, nonce: nonce.toString(), deadline: String(deadline) },
  };
  const transfer = `0xc1fb425e${addr(ROUTER)}${addr(fromToken)}${word(request.fromAmount)}${word(nonce)}${word(deadline)}${word(0xc0)}`;
  const path = `${fromToken}00000000${"00".repeat(20)}${toToken.slice(2)}` as Hex;
  const v3 = `0x8d68a156${encodeAbiParameters(parseAbiParameters("address recipient, uint256 ppm, bytes path, uint256 amountOutMin"), [ROUTER, BigInt(1_000_000), path, BigInt(0)]).slice(2)}`;
  const makerSignature = makerDeadline === undefined ? undefined : invalidMakerSig ? "0x1234" : await makerAccount.signTypedData({
    domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS },
    primaryType: "PermitWitnessTransferFrom",
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
        { name: "consideration", type: "Consideration" },
      ],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
      Consideration: [
        { name: "token", type: "address" }, { name: "amount", type: "uint256" },
        { name: "counterparty", type: "address" }, { name: "partialFillAllowed", type: "bool" },
      ],
    },
    message: {
      permitted: { token: toToken, amount: BigInt(1000) }, spender: ROUTER, nonce: BigInt(4), deadline: makerDeadline,
      consideration: { token: fromToken, amount: request.fromAmount, counterparty: request.taker, partialFillAllowed: true },
    },
  });
  const rfq = makerDeadline === undefined ? undefined : `0xd92aadfb${encodeAbiParameters(
    parseAbiParameters("address recipient, ((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit, address maker, bytes makerSig, address takerToken, uint256 maxTakerAmount"),
    [ROUTER, { permitted: { token: toToken, amount: BigInt(1000) }, nonce: BigInt(4), deadline: makerDeadline }, POOL, makerSignature!, fromToken, request.fromAmount],
  ).slice(2)}`;
  const swap = rfq ?? v3;
  const paddedSwap = `${word((swap.length - 2) / 2)}${swap.slice(2)}${"0".repeat((32 - ((swap.length - 2) / 2) % 32) % 32 * 2)}`;
  const offset = 64 + paddedSwap.length / 2;
  const data = `0x1fff991f${addr(OWNER)}${addr(toToken)}${word(990)}${word(0xa0)}${word(0)}${word(2)}${word(offset)}${word(64)}${paddedSwap}${word(0xffff)}${transfer.slice(2)}` as Hex;
  return {
    liquidityAvailable: true, fromToken, toToken, fromAmount: request.fromAmount,
    toAmount: BigInt(1000), minToAmount: BigInt(990), blockNumber: BigInt(1000),
    fees: { gasFee: null, protocolFee: null },
    issues: { allowance: { currentAllowance: BigInt(0), spender: PERMIT2_ADDRESS }, balance: null, simulationIncomplete: false },
    transaction: { to: ROUTER, data, value: BigInt(0), gas: BigInt(100_000), gasPrice: BigInt(2) },
    permit2: { hash: hashTypedData(eip712 as Parameters<typeof hashTypedData>[0]).toLowerCase() as Hex, eip712 },
  };
}

async function prepared(direction: "buy" | "sell", provider: "base-account" | "cdp-embedded" = "cdp-embedded", allowance = false, deadline?: number, options: {
  nonce?: bigint;
  bitmapResult?: unknown;
  throwBitmap?: boolean;
  onBitmapCall?: (to: string, data: string, blockTag: unknown) => void;
  onTokenCall?: (functionName: "balanceOf" | "allowance", to: string, data: string, blockTag: unknown) => void;
  onMakerTokenCall?: (functionName: "balanceOf" | "allowance", to: string, data: string, blockTag: unknown) => void;
  makerBalanceResult?: unknown;
  makerAllowanceResult?: unknown;
  balanceResult?: unknown;
  allowanceResult?: unknown;
  chainAllowance?: bigint;
  throwTokenRead?: "balanceOf" | "allowance";
  quoteAllowanceIssue?: boolean;
  quoteBalanceIssue?: boolean;
  makerDeadline?: bigint;
  invalidMakerSig?: boolean;
  signerAddress?: Address;
} = {}) {
  const request = new Request("https://home.test/api/actions/prepare");
  const params = { version: 1, assetId: "cbbtc", direction, amountBaseUnits: "1000000" };
  let key = "";
  const result = await prepareTradeAction({ session: sessions(provider), request, params }, {
    now: () => NOW,
    resolveSigner: async () => ({ smartAccount: OWNER, signerAddress: options.signerAddress ?? OWNER, ownerIndex: 0, deployed: true }),
    createSwapsClient: () => ({ getPrice: async () => ({ liquidityAvailable: false }), createQuote: async (swapRequest) => {
      expect(swapRequest).toMatchObject({ ...swapTokens(direction), taker: OWNER, fromAmount: BigInt(1_000_000), slippageBps: 100 });
      expect(swapRequest.signerAddress).toBeUndefined();
      key = swapRequest.requestKey ?? "";
      const quote = await quoteFor(input(direction), options.nonce, options.makerDeadline, options.invalidMakerSig);
      if (allowance || options.quoteAllowanceIssue === false) quote.issues.allowance = null;
      if (options.quoteBalanceIssue) quote.issues.balance = { token: quote.fromToken, currentBalance: BigInt(0), requiredBalance: quote.fromAmount };
      if (deadline) (quote.permit2!.eip712 as { message: { deadline: string } }).message.deadline = String(deadline);
      return quote;
    } }),
    rpc: async (method, rpcParams) => {
      if (method === "eth_chainId") return "0x2105";
      if (method === "eth_blockNumber") return "0x3e8";
      if (method === "eth_getCode") {
        expect(rpcParams).toEqual([POOL, "0x3e8"]);
        return "0x";
      }
      if (method !== "eth_call") throw new Error(`Unexpected RPC method: ${method}`);
      const call = rpcParams[0] as { to: string; data: string };
      if (call.to.toLowerCase() === PERMIT2_ADDRESS && call.data.slice(0, 10) === "0x4fe02b44") {
        options.onBitmapCall?.(call.to, call.data, rpcParams[1]);
        if (options.throwBitmap) throw new Error("Permit2 RPC failed");
        return options.bitmapResult === undefined ? `0x${word(BigInt(0))}` : options.bitmapResult;
      }
      if (call.to.toLowerCase() === "0x00000000000004533fe15556b1e086bb1a72ceae" && call.data.slice(0, 10) === "0x6352211e") return `0x${"0".repeat(24)}${ROUTER.slice(2)}`;
      if (options.makerDeadline !== undefined && call.to.toLowerCase() === swapTokens(direction).toToken) {
        const functionName = call.data.slice(0, 10) === "0x70a08231" ? "balanceOf" : call.data.slice(0, 10) === "0xdd62ed3e" ? "allowance" : null;
        if (!functionName) throw new Error(`Unexpected maker token call: ${call.data}`);
        options.onMakerTokenCall?.(functionName, call.to, call.data, rpcParams[1]);
        expect(call.data).toBe(encodeFunctionData({ abi: erc20Abi, functionName, args: functionName === "balanceOf" ? [POOL] : [POOL, PERMIT2_ADDRESS] }));
        return functionName === "balanceOf" ? options.makerBalanceResult ?? `0x${word(1000)}` : options.makerAllowanceResult ?? `0x${word(1000)}`;
      }
      if (call.to.toLowerCase() === swapTokens(direction).fromToken) {
        const functionName = call.data.slice(0, 10) === "0x70a08231" ? "balanceOf" : call.data.slice(0, 10) === "0xdd62ed3e" ? "allowance" : null;
        if (!functionName) throw new Error(`Unexpected token call: ${call.data}`);
        options.onTokenCall?.(functionName, call.to, call.data, rpcParams[1]);
        if (options.throwTokenRead === functionName) throw new Error(`${functionName} RPC failed`);
        if (functionName === "balanceOf") return options.balanceResult === undefined ? `0x${word(2_000_000)}` : options.balanceResult;
        return options.allowanceResult === undefined ? `0x${word(options.chainAllowance ?? (allowance ? 1_000_000 : 0))}` : options.allowanceResult;
      }
      throw new Error(`Unexpected eth_call target: ${call.to}`);
    },
  });
  return { ...result, key };
}

afterEach(() => setActionsStoreForTests(null));
describe("trade preparation", () => {
  test.each(["buy", "sell"] as const)("reviews %s with exact spend, estimated receive and expiry", async (direction) => {
    const { draft, pending, key, callGasLimit } = await prepared(direction);
    expect(callGasLimit).toBe(BigInt(100_000));
    expect(draft.title).toBe(direction === "buy" ? "Buy Bitcoin" : "Sell Bitcoin");
    expect(draft.amounts).toMatchObject([
      { assetId: direction === "buy" ? "usdc" : "cbbtc", amountBaseUnits: "1000000", direction: "spend" },
      { assetId: direction === "buy" ? "cbbtc" : "usdc", amountBaseUnits: "1000", estimated: true, direction: "receive" },
    ]);
    expect(draft.calls[0]).toMatchObject({ to: direction === "buy" ? BASE_USDC_ADDRESS.toLowerCase() : swapTokens("sell").fromToken, approval: { spender: PERMIT2_ADDRESS }, value: "0" });
    expect(draft.calls[0]?.data).toBe(`0x095ea7b3${addr(PERMIT2_ADDRESS)}${word(1_000_000)}`);
    expect(draft.calls[1]).toMatchObject({ to: ROUTER, value: "0" });
    expect(draft.expiresAt).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(draft.metadata).toMatchObject({ product: "trade", minimumToAmountBaseUnits: "990", approval: "permit2-exact", quoteBlockNumber: "1000" });
    expect(pending.signingTypedData.message.hash).toBe(pending.permitHash);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });
  test("bounds RFQ review expiry by the maker deadline while retaining the taker permit metadata", async () => {
    const makerDeadline = BigInt(Math.floor(NOW.getTime() / 1000) + 45);
    const { draft } = await prepared("buy", "cdp-embedded", false, undefined, { makerDeadline });
    expect(draft.expiresAt).toBe(new Date(Number(makerDeadline) * 1000 - 30_000).toISOString());
    expect(draft.metadata).toMatchObject({ permitDeadline: String(Math.floor(NOW.getTime() / 1000) + 90), executionDeadline: makerDeadline.toString() });
  });
  test("reads the RFQ maker's nonce bitmap at the same pinned block as the taker's", async () => {
    const reads: string[] = [];
    const makerReads: string[] = [];
    await prepared("buy", "cdp-embedded", false, undefined, {
      makerDeadline: BigInt(Math.floor(NOW.getTime() / 1000) + 45),
      onMakerTokenCall: (method, to, _data, tag) => {
        expect(to).toBe(swapTokens("buy").toToken);
        expect(tag).toBe("0x3e8");
        makerReads.push(method);
      },
      onBitmapCall: (_to, data, tag) => {
        expect(tag).toBe("0x3e8");
        reads.push(data);
      },
    });
    expect(reads).toEqual([`0x4fe02b44${addr(OWNER)}${word(0)}`, `0x4fe02b44${addr(POOL)}${word(0)}`]);
    expect(makerReads).toEqual(["balanceOf", "allowance"]);
  });
  test("rejects an invalid maker signature without issuing a draft", async () => {
    const failure = await prepared("buy", "cdp-embedded", false, undefined, {
      makerDeadline: BigInt(Math.floor(NOW.getTime() / 1000) + 45), invalidMakerSig: true,
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: "unverified-actions" });
    expect(tradePreparationResponse(failure)).toMatchObject({ code: "TRADE_QUOTE_REJECTED", status: 502 });
  });
  test.each(["buy", "sell"] as const)("rejects a %s RFQ whose maker is the resolved embedded signer", async (direction) => {
    const makerDeadline = BigInt(Math.floor(NOW.getTime() / 1000) + 45);
    await expect(prepared(direction, "cdp-embedded", false, undefined, { makerDeadline, signerAddress: POOL }))
      .rejects.toMatchObject({ reason: "unverified-actions" });
  });
  test.each(["base-account", "cdp-embedded"] as const)("issues %s signing facts", async (provider) => {
    const { draft } = await prepared("buy", provider, true);
    expect(draft.signing?.signer).toBe(provider);
    expect(draft.calls).toHaveLength(1);
    expect(draft.metadata).toMatchObject({ approval: "existing-permit2-allowance" });
    if (provider === "base-account") expect(draft.signing?.typedData.domain.name).toBe("Permit2");
    else expect(draft.signing?.typedData.domain.name).toBe("Coinbase Smart Wallet");
  });
  test.each(["buy", "sell"] as const)("rejects %s when chain balance is short despite no quote balance issue", async (direction) => {
    await expect(prepared(direction, "cdp-embedded", false, undefined, { balanceResult: `0x${word(999_999)}` }))
      .rejects.toMatchObject({ reason: "insufficient-balance" });
  });
  test.each(["buy", "sell"] as const)("rejects %s when the quote reports a balance issue despite sufficient chain balance", async (direction) => {
    await expect(prepared(direction, "cdp-embedded", false, undefined, { quoteBalanceIssue: true }))
      .rejects.toMatchObject({ reason: "insufficient-balance" });
  });
  test.each(["buy", "sell"] as const)("approves %s exactly when chain allowance is short despite no quote allowance issue", async (direction) => {
    const { draft } = await prepared(direction, "cdp-embedded", false, undefined, { quoteAllowanceIssue: false, chainAllowance: BigInt(999_999) });
    expect(draft.calls).toHaveLength(2);
    expect(draft.calls[0]).toMatchObject({ to: swapTokens(direction).fromToken, data: `0x095ea7b3${addr(PERMIT2_ADDRESS)}${word(1_000_000)}` });
    expect(draft.metadata).toMatchObject({ approval: "permit2-exact" });
  });
  test.each(["buy", "sell"] as const)("omits %s approval when chain allowance covers amount despite quote allowance issue", async (direction) => {
    const { draft } = await prepared(direction, "cdp-embedded", false, undefined, { chainAllowance: BigInt(1_000_000) });
    expect(draft.calls).toHaveLength(1);
    expect(draft.calls[0]).toMatchObject({ to: ROUTER });
    expect(draft.metadata).toMatchObject({ approval: "existing-permit2-allowance" });
  });
  test.each(["buy", "sell"] as const)("reads %s token balance and Permit2 allowance at the pinned block", async (direction) => {
    const calls: Array<[string, string, string, unknown]> = [];
    await prepared(direction, "cdp-embedded", false, undefined, {
      onTokenCall: (functionName, to, data, blockTag) => calls.push([functionName, to, data, blockTag]),
    });
    expect(calls).toEqual([
      ["balanceOf", swapTokens(direction).fromToken, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [OWNER] }), "0x3e8"],
      ["allowance", swapTokens(direction).fromToken, encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [OWNER, PERMIT2_ADDRESS] }), "0x3e8"],
    ]);
  });
  test.each(["buy", "sell"] as const)("maps failing or malformed %s token reads to provider-unavailable", async (direction) => {
    for (const functionName of ["balanceOf", "allowance"] as const) {
      await expect(prepared(direction, "cdp-embedded", false, undefined, { throwTokenRead: functionName }))
        .rejects.toMatchObject({ reason: "provider-unavailable" });
      for (const result of ["0x", `0x${"0".repeat(63)}g`, `0x${"0".repeat(65)}`, null]) {
        await expect(prepared(direction, "cdp-embedded", false, undefined, { [functionName === "balanceOf" ? "balanceResult" : "allowanceResult"]: result }))
          .rejects.toMatchObject({ reason: "provider-unavailable" });
      }
    }
  });
  test("rejects mismatched signer and invalid input before requesting a quote", async () => {
    const request = new Request("https://home.test/api/actions/prepare");
    const session = sessions();
    const deps = { resolveSigner: async () => ({ smartAccount: POOL, signerAddress: OWNER, ownerIndex: 0 as const, deployed: true }) };
    await expect(prepareTradeAction({ session, request, params: { version: 1, assetId: "cbbtc", direction: "buy", amountBaseUnits: "100" } }, deps)).rejects.toMatchObject({ reason: "signer-unsupported" });
    await expect(prepareTradeAction({ session, request, params: { version: 1, assetId: "cbbtc", direction: "buy", amountBaseUnits: "1.5" } }, deps)).rejects.toMatchObject({ reason: "invalid-request" });
  });
  test.each([
    ["invalid-request", "TRADE_INVALID", 400], ["signer-unsupported", "TRADE_SIGNER_UNSUPPORTED", 422],
    ["smart-account-unavailable", "TRADE_SIGNER_UNSUPPORTED", 422], ["insufficient-balance", "TRADE_INSUFFICIENT_BALANCE", 409],
    ["no-liquidity", "TRADE_NO_LIQUIDITY", 422], ["stale-quote", "TRADE_QUOTE_STALE", 409], ["permit-used", "TRADE_QUOTE_STALE", 409],
    ["quote-rejected", "TRADE_QUOTE_REJECTED", 502], ["unverified-actions", "TRADE_QUOTE_REJECTED", 502],
    ["permit-expired", "TRADE_QUOTE_REJECTED", 502], ["provider-unavailable", "TRADE_UNAVAILABLE", 503],
  ] as const)("maps %s to %s", (reason, code, status) => {
    expect(tradePreparationResponse(new TradePreparationError(reason))).toMatchObject({ code, status });
    expect(tradePreparationResponse(new TradePreparationError(reason))?.message).not.toContain("CDP");
  });
  test("passes when the Permit2 bitmap is unset and reads the owner word at the pinned block", async () => {
    let read = false;
    const { draft } = await prepared("buy", "cdp-embedded", false, undefined, {
      nonce: BigInt(260),
      bitmapResult: `0x${word(BigInt(0))}`,
      onBitmapCall: (to, data, blockTag) => {
        read = true;
        expect(to).toBe(PERMIT2_ADDRESS);
        expect(data).toBe(`0x4fe02b44${addr(OWNER)}${word(BigInt(1))}`);
        expect(blockTag).toBe("0x3e8");
      },
    });
    expect(read).toBe(true);
    expect(draft.kind).toBe("trade");
  });
  test("rejects a used Permit2 nonce before returning a draft", async () => {
    const error = await prepared("buy", "cdp-embedded", false, undefined, { nonce: BigInt(260), bitmapResult: `0x${word(BigInt(1) << BigInt(4))}` })
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ reason: "permit-used" });
    expect(tradePreparationResponse(error)).toEqual({ code: "TRADE_QUOTE_STALE", message: "This trade quote can no longer be used. Get a new quote.", status: 409 });
  });
  test("allows another used bit in the same Permit2 word", async () => {
    const { draft } = await prepared("buy", "cdp-embedded", false, undefined, { nonce: BigInt(260), bitmapResult: `0x${word(BigInt(1) << BigInt(5))}` });
    expect(draft.kind).toBe("trade");
  });
  test.each(["0x", `0x${"0".repeat(63)}g`, `0x${"0".repeat(65)}`, null])("maps malformed Permit2 bitmap %p to provider-unavailable", async (bitmapResult) => {
    await expect(prepared("buy", "cdp-embedded", false, undefined, { bitmapResult })).rejects.toMatchObject({ reason: "provider-unavailable" });
  });
  test("maps a failing Permit2 bitmap read to provider-unavailable", async () => {
    await expect(prepared("buy", "cdp-embedded", false, undefined, { throwBitmap: true })).rejects.toMatchObject({ reason: "provider-unavailable" });
  });
  test.each([false, true])("persists final swap index with fee prepended: %s", async (fee) => {
    const trade = await prepared("buy");
    const inserts: Array<Parameters<ActionsStore["insert"]>[0]> = [];
    setActionsStoreForTests({ insert: async (value: Parameters<ActionsStore["insert"]>[0]) => { inserts.push(value); }, findUnresolvedTrade: async () => null } as unknown as ActionsStore);
    const handler = createPrepareActionHandler({
      authorize: async () => Response.json(sessions()),
      prepareTrade: async () => trade,
      applyFee: async (_session, draft, options) => {
        expect(options?.callGasLimit).toBe(BigInt(100_000));
        return fee
          ? { ...draft, calls: [makePaymasterApproval(BigInt(100_000)), ...draft.calls],
              networkFee: { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "100000", decimals: 6 } }
          : draft;
      },
    });
    const response = await handler(new Request("https://home.test/api/actions/prepare", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "trade", params: { version: 1, assetId: "cbbtc", direction: "buy", amountBaseUnits: "1000000" } }),
    }));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(trade.key).not.toBe(result.id);
    expect(inserts[0]?.pending.swapCallIndex).toBe(fee ? 2 : 1);
    expect(inserts[0]?.pending.calls[inserts[0]!.pending.swapCallIndex!]?.to).toBe(ROUTER);
    expect(inserts[0]?.summary.signing).toEqual(result.signing);
  });
  test("normalizes addresses and rejects tampered trade metadata or signing", async () => {
    const preparedTrade = await prepared("buy");
    setActionsStoreForTests({ insert: async () => {} } as unknown as ActionsStore);
    const draft = structuredClone(preparedTrade.draft);
    if (draft.metadata?.product !== "trade" || draft.signing?.signer !== "cdp-embedded") throw new Error("missing trade facts");
    draft.metadata.fromAsset.address = draft.metadata.fromAsset.address.toUpperCase().replace("0X", "0x") as Address;
    draft.signing.evmAccount = draft.signing.evmAccount.toUpperCase().replace("0X", "0x") as Address;
    const result = await issueMoneyAction(sessions(), draft, { pending: { ...preparedTrade.pending, swapCallIndex: 1 } });
    expect(result.metadata?.product === "trade" && result.metadata.fromAsset.address).toBe(BASE_USDC_ADDRESS.toLowerCase() as Address);
    expect(result.signing?.signer === "cdp-embedded" && result.signing.evmAccount).toBe(OWNER);
    if (draft.metadata.product !== "trade") throw new Error("missing trade metadata");
    draft.metadata.minimumToAmountBaseUnits = "1001";
    await expect(issueMoneyAction(sessions(), draft, { pending: { ...preparedTrade.pending, swapCallIndex: 1 } })).rejects.toMatchObject({ reason: "invalid-draft" });
    draft.metadata.minimumToAmountBaseUnits = "990";
    for (const executionDeadline of [undefined, "invalid", (BigInt(draft.metadata.permitDeadline) + BigInt(1)).toString()]) {
      const tampered = structuredClone(draft);
      if (tampered.metadata?.product !== "trade") throw new Error("missing trade metadata");
      tampered.metadata.executionDeadline = executionDeadline as string;
      await expect(issueMoneyAction(sessions(), tampered, { pending: { ...preparedTrade.pending, swapCallIndex: 1 } }))
        .rejects.toMatchObject({ reason: "invalid-draft" });
    }
    if (draft.signing.signer !== "cdp-embedded") throw new Error("missing signer");
    draft.signing.typedData.message.hash = `0x${"ab".repeat(32)}`;
    await expect(issueMoneyAction(sessions(), draft, { pending: { ...preparedTrade.pending, swapCallIndex: 1 } })).rejects.toMatchObject({ reason: "invalid-draft" });
  });
  test("maps missing credentials to unavailable", () => {
    expect(tradePreparationResponse(new CdpSwapsUnavailableError())).toMatchObject({ code: "TRADE_UNAVAILABLE", status: 503 });
  });
});
