import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeFunctionData, hashTypedData, isHex, keccak256, parseAbi, parseAbiParameters, stringToHex, toFunctionSelector, type AbiParameter } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { isRecord } from "@/shared/guards";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import type { Address, Hex } from "@/shared/trading/server-types";
import type { SwapQuote } from "./cdp-swaps";
import { PERMIT2_ADDRESS, TradePreparationError } from "./permit2";
import { checkQuoteCompatibility, readSettlerRouter, rfqMakerAuthorizations, swapExecutionMatches, swapTokens, validateSwapQuote, type SwapReviewRequest } from "./quote";
import { verifyRfqMakerAuthorizations } from "./rfq-maker";

type FullQuote = Extract<SwapQuote, { liquidityAvailable: true }>;
const TOKEN = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" as Address;
const NOW = new Date("2026-09-24T12:00:00.000Z");
const TARGET = "0x3333333333333333333333333333333333333333" as Address;
const TAKER = "0x1111111111111111111111111111111111111111" as Address;
const POOL = "0x5555555555555555555555555555555555555555" as Address;
const FEE_TO = "0x6666666666666666666666666666666666666666" as Address;
const MAKER = "0x7777777777777777777777777777777777777777" as Address;
const SIGNER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
const INTERMEDIATE = "0x8888888888888888888888888888888888888888" as Address;
const NEXT_POOL = "0x9999999999999999999999999999999999999999" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, "0");
const addressWord = (address: Address) => word(BigInt(address));
const action = (selector: string, abi: readonly AbiParameter[], values: readonly unknown[]) =>
  `${selector}${encodeAbiParameters(abi, values as never).slice(2)}`.toLowerCase() as Hex;
const basicAbi = parseAbiParameters("address sellToken, uint256 ppm, address pool, uint256 offset, bytes data");
const v2Abi = parseAbiParameters("address recipient, address sellToken, uint256 ppm, address pool, uint24 swapInfo, uint256 amountOutMin");
const v3Abi = parseAbiParameters("address recipient, uint256 ppm, bytes path, uint256 amountOutMin");
const maverickAbi = parseAbiParameters("address recipient, address sellToken, uint256 ppm, address pool, bool tokenAIn, int32 tickLimit, uint256 minBuyAmount");
const rfqAbi = parseAbiParameters("address recipient, ((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit, address maker, bytes makerSig, address takerToken, uint256 maxTakerAmount");
const slippageAbi = parseAbiParameters("address recipient, address token, uint256 expectedAmount, uint256 maxPpm");
function transfer(input: SwapReviewRequest, recipient: Address = TARGET, token = swapTokens(input.direction, TOKEN).fromToken) {
  return `0xc1fb425e${addressWord(recipient)}${addressWord(token)}${word(input.fromAmount)}${word(4)}${word(Math.floor(NOW.getTime() / 1000) + 900)}${word(0xc0)}` as Hex;
}
function fee(token: Address, ppm: number, recipient: Address = FEE_TO) {
  return action("0x38c9c147", basicAbi, [token, BigInt(ppm), token, BigInt(36), `0xa9059cbb${addressWord(recipient)}${word(123)}`]);
}
function poolSwap(token: Address, pool: Address = POOL) {
  return action("0x38c9c147", basicAbi, [token, BigInt(1_000_000), pool, BigInt(36), `0x12345678${"00".repeat(64)}`]);
}
function v2(recipient: Address, token: Address, ppm: bigint, pool: Address = POOL) {
  return action("0x103b48be", v2Abi, [recipient, token, ppm, pool, BigInt(0), BigInt(0)]);
}
function maverick(recipient: Address, token: Address, ppm: bigint, pool: Address = POOL) {
  return action("0x9b59756f", maverickAbi, [recipient, token, ppm, pool, true, -1, BigInt(0)]);
}
function path(...tokens: Address[]): Hex {
  return `${tokens[0]}${tokens.slice(1).map((token) => `00000000${"00".repeat(20)}${token.slice(2)}`).join("")}` as Hex;
}
function v3(input: SwapReviewRequest, recipient: Address = TARGET, route?: Hex) {
  const { fromToken, toToken } = swapTokens(input.direction, TOKEN);
  return action("0x8d68a156", v3Abi, [recipient, BigInt(1_000_000), route ?? path(fromToken, toToken), BigInt(0)]);
}
function v3Ppm(input: SwapReviewRequest, ppm: bigint, route?: Hex) {
  const { fromToken, toToken } = swapTokens(input.direction, TOKEN);
  return action("0x8d68a156", v3Abi, [TARGET, ppm, route ?? path(fromToken, toToken), BigInt(0)]);
}
function positive(input: SwapReviewRequest, expected = BigInt(1001), recipient: Address = FEE_TO) {
  return action("0x34ee90ca", slippageAbi, [recipient, swapTokens(input.direction, TOKEN).toToken, expected, BigInt(1_000_000)]);
}
function defaultActions(input: SwapReviewRequest): Hex[] {
  const { fromToken, toToken } = swapTokens(input.direction, TOKEN);
  return input.direction === "buy"
    ? [transfer(input), fee(fromToken, 7500), fee(fromToken, 1000), v3(input), positive(input)]
    : [transfer(input), poolSwap(fromToken), positive(input), fee(toToken, 500), fee(toToken, 1000)];
}
function settlerData(toToken: Address, options: { recipient?: Address; buyToken?: Address; minAmountOut?: bigint; actions?: Hex[] } = {}) {
  const actions = options.actions ?? defaultActions(request);
  let offset = actions.length * 32;
  const elements = actions.slice(1).map((item) => {
    const bytes = (item.length - 2) / 2;
    const encoded = `${word(bytes)}${item.slice(2)}${"0".repeat((32 - bytes % 32) % 32 * 2)}`;
    const start = offset;
    offset += encoded.length / 2;
    return { encoded, start };
  });
  const offsets = [offset, ...elements.map((item) => item.start)];
  return `0x1fff991f${addressWord(options.recipient ?? TAKER)}${addressWord(options.buyToken ?? toToken)}${word(options.minAmountOut ?? BigInt(990))}${word(0xa0)}${word(0)}${word(actions.length)}${offsets.map(word).join("")}${elements.map((item) => item.encoded).join("")}${word(0xffff)}${actions[0]?.slice(2) ?? ""}` as Hex;
}
const request: SwapReviewRequest = { token: TOKEN, direction: "buy", fromAmount: BigInt(1_000_000), taker: TAKER, slippageBps: 100 };
function fixture(input: SwapReviewRequest = request, target: Address = TARGET) {
  const { fromToken, toToken } = swapTokens(input.direction, TOKEN);
  const eip712 = {
    domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS as Address },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    },
    primaryType: "PermitTransferFrom",
    message: { permitted: { token: fromToken, amount: input.fromAmount.toString() }, spender: target, nonce: "4", deadline: String(Math.floor(NOW.getTime() / 1000) + 900) },
  };
  return {
    liquidityAvailable: true, fromToken, toToken, fromAmount: input.fromAmount,
    toAmount: BigInt(1000), minToAmount: BigInt(990), blockNumber: BigInt(1000),
    fees: { gasFee: { token: fromToken, amount: BigInt(1) }, protocolFee: { token: input.direction === "buy" ? fromToken : toToken, amount: BigInt(input.direction === "buy" ? 8500 : 2) } as FullQuote["fees"]["protocolFee"] },
    issues: { allowance: null as FullQuote["issues"]["allowance"], balance: null, simulationIncomplete: false },
    transaction: { to: target, data: settlerData(toToken, { actions: defaultActions(input) }), value: BigInt(0), gas: BigInt(100), gasPrice: BigInt(2) },
    permit2: { hash: hashTypedData(eip712 as Parameters<typeof hashTypedData>[0]).toLowerCase() as `0x${string}`, eip712 },
  } satisfies SwapQuote;
}
function validate(quote: SwapQuote, input = request, swapRouter = TARGET) {
  return validateSwapQuote({ request: input, quote, now: NOW, currentBlockNumber: BigInt(1000), swapRouter });
}
function rfqLeg(quote: FullQuote, maxTakerAmount: bigint, nonce = BigInt(4), capacity = BigInt(1000)) {
  return action("0xd92aadfb", rfqAbi, [TARGET,
    { permitted: { token: quote.toToken, amount: capacity }, nonce, deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) },
    MAKER, "0x1234", quote.fromToken, maxTakerAmount]);
}
function assertSpend(quote: FullQuote, expected: "exact" | "underfill" | "overfill" | "unmodeled", input = request) {
  expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({ actionsVerified: expected === "exact", inputSpend: expected });
  if (expected === "exact") expect(() => validate(quote, input)).not.toThrow();
  else expect(() => validate(quote, input)).toThrow("stale-quote");
}
function changedPermit(change: (typed: ReturnType<typeof fixture>["permit2"]["eip712"]) => void) {
  const quote = fixture();
  change(quote.permit2.eip712);
  return quote;
}

describe("swap quote review", () => {
  test("resolves the current Settler from the Deployer ownerOf(2) word", async () => {
    const calls: unknown[] = [];
    const resolved = await readSettlerRouter(async (method, params) => {
      calls.push([method, params]);
      return `0x${"0".repeat(24)}4F6F91599858BF0D19FABCF2C5D591FE13F7C059`;
    });
    expect(resolved).toBe("0x4f6f91599858bf0d19fabcf2c5d591fe13f7c059");
    expect(calls).toEqual([["eth_call", [{ to: "0x00000000000004533Fe15556B1E086BB1A72cEae", data: `0x6352211e${"0".repeat(63)}2` }, "latest"]]]);
  });
  test.each(["0x", `0x${"0".repeat(64)}`, `0x${"0".repeat(23)}1${"1".repeat(40)}`, `0x${"0".repeat(24)}${PERMIT2_ADDRESS.slice(2)}`])("rejects invalid registry response", async (result) => {
    await expect(readSettlerRouter(async () => result)).rejects.toThrow("quote-rejected");
  });
  test.each(["buy", "sell"] as const)("validates %s real-layout fee and swap actions", (direction) => {
    const input = { ...request, direction };
    const quote = fixture(input);
    expect(swapExecutionMatches(input, quote, TARGET)).toEqual({
      targetMatchesRouter: true, calldataMatches: true, actionSelectors: direction === "buy"
        ? ["0xc1fb425e", "0x38c9c147", "0x38c9c147", "0x8d68a156", "0x34ee90ca"]
        : ["0xc1fb425e", "0x38c9c147", "0x34ee90ca", "0x38c9c147", "0x38c9c147"], actionsVerified: true, inputSpend: "exact",
    });
    expect(() => validate(quote, input)).not.toThrow();
    expect(() => validate({ ...quote, transaction: { ...quote.transaction, gas: BigInt(3000000) } }, input)).not.toThrow();
  });
  test.each(["v2", "rfq"] as const)("validates %s swap variant", (variant) => {
    const quote = fixture();
    const swap = variant === "v2"
      ? action("0x103b48be", v2Abi, [TARGET, quote.fromToken, BigInt(1000000), POOL, BigInt(0), BigInt(0)])
      : action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: quote.toToken, amount: BigInt(1000) }, nonce: BigInt(4), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) }, MAKER, "0x1234", quote.fromToken, quote.fromAmount]);
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request, variant === "v2" ? POOL : TARGET), swap, positive(request)] });
    quote.fees.protocolFee = null;
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(true);
    expect(() => validate(quote)).not.toThrow();
  });
  test.each(["buy", "sell"] as const)("rejects a %s RFQ whose maker capacity is below the reviewed minimum", (direction) => {
    const input = { ...request, direction };
    const quote = fixture(input);
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(input),
      action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: quote.toToken, amount: quote.minToAmount - BigInt(1) }, nonce: BigInt(4), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) }, MAKER, "0x1234", quote.fromToken, quote.fromAmount]),
      positive(input)] });
    expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({ actionsVerified: false, inputSpend: null });
    expect(() => validate(quote, input)).toThrow("unverified-actions");
    for (const capacity of [quote.minToAmount, quote.minToAmount + BigInt(1)]) {
      quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(input),
        action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: quote.toToken, amount: capacity }, nonce: BigInt(4), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) }, MAKER, "0x1234", quote.fromToken, quote.fromAmount]),
        positive(input)] });
      expect(swapExecutionMatches(input, quote, TARGET).actionsVerified).toBe(true);
      expect(() => validate(quote, input)).not.toThrow();
    }
  });
  test.each([BigInt(500), BigInt(1000)])("accepts exact mixed RFQ and V3 routes regardless of maker capacity %s", (capacity) => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request),
      rfqLeg(quote, BigInt(500_000), BigInt(4), capacity), v3(request), positive(request)] });
    assertSpend(quote, "exact");
  });
  test.each([
    ["RFQ-only exact", (q: FullQuote) => [rfqLeg(q, BigInt(500_000)), rfqLeg(q, BigInt(500_000), BigInt(5))], "exact"],
    ["RFQ-only underfill", (q: FullQuote) => [rfqLeg(q, BigInt(500_000)), rfqLeg(q, BigInt(499_999), BigInt(5))], "underfill"],
    ["RFQ-only final clamp", (q: FullQuote) => [rfqLeg(q, BigInt(500_000)), rfqLeg(q, BigInt(500_001), BigInt(5))], "exact"],
    ["RFQ-only overfill", (q: FullQuote) => [rfqLeg(q, q.fromAmount), rfqLeg(q, BigInt(1), BigInt(5))], "overfill"],
    ["RFQ then V3 exact", (q: FullQuote) => [rfqLeg(q, BigInt(500_000)), v3Ppm(request, BigInt(1_000_000))], "exact"],
    ["RFQ then V3 underfill", (q: FullQuote) => [rfqLeg(q, BigInt(500_000)), v3Ppm(request, BigInt(500_000))], "underfill"],
    ["RFQ then V3 overfill", (q: FullQuote) => [rfqLeg(q, q.fromAmount), v3Ppm(request, BigInt(1_000_000))], "overfill"],
    ["RFQ over-allots a nonfinal leg", (q: FullQuote) => [rfqLeg(q, BigInt(600_000)), v3Ppm(request, BigInt(500_000)), rfqLeg(q, BigInt(300_000), BigInt(5)), v3Ppm(request, BigInt(1_000_000))], "overfill"],
    ["V3 floor spends zero", (q: FullQuote) => [rfqLeg(q, BigInt(999_999)), v3Ppm(request, BigInt(500_000))], "underfill"],
    ["V3 then RFQ exact", (q: FullQuote) => [v3Ppm(request, BigInt(500_000)), rfqLeg(q, BigInt(500_000))], "exact"],
    ["V3 then RFQ underfill", (q: FullQuote) => [v3Ppm(request, BigInt(500_000)), rfqLeg(q, BigInt(499_999))], "underfill"],
    ["V3 then RFQ final clamp", (q: FullQuote) => [v3Ppm(request, BigInt(500_000)), rfqLeg(q, BigInt(500_001))], "exact"],
    ["V3 split exact", () => [v3Ppm(request, BigInt(500_000)), v3Ppm(request, BigInt(1_000_000))], "exact"],
    ["V3 split underfill", () => [v3Ppm(request, BigInt(500_000)), v3Ppm(request, BigInt(500_000))], "underfill"],
    ["V3 split overfill", () => [v3Ppm(request, BigInt(1_000_000)), v3Ppm(request, BigInt(1_000_000))], "overfill"],
    ["V3 rounding exact", (q: FullQuote) => [v3Ppm(request, BigInt(333_333)), rfqLeg(q, BigInt(666_667))], "exact"],
    ["V3 rounding underfill", (q: FullQuote) => [v3Ppm(request, BigInt(333_333)), rfqLeg(q, BigInt(666_666))], "underfill"],
  ] as const)("models %s", (_label, swaps, expected) => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request), ...swaps(quote), positive(request)] });
    assertSpend(quote, expected);
  });
  test.each([
    ["RFQ then V3 exact", (q: FullQuote) => [rfqLeg(q, BigInt(500_000)), v3Ppm(request, BigInt(1_000_000))], "exact"],
    ["RFQ then V3 underfill", (q: FullQuote) => [rfqLeg(q, BigInt(500_000)), v3Ppm(request, BigInt(999_999))], "underfill"],
    ["RFQ-only exact", (q: FullQuote) => [rfqLeg(q, BigInt(500_000)), rfqLeg(q, BigInt(492_500), BigInt(5))], "exact"],
    ["RFQ-only off-by-one", (q: FullQuote) => [rfqLeg(q, BigInt(500_000)), rfqLeg(q, BigInt(492_499), BigInt(5))], "underfill"],
  ] as const)("accounts for an input fee before %s", (_label, swaps, expected) => {
    const quote = fixture();
    quote.fees.protocolFee = { token: quote.fromToken, amount: BigInt(7_500) };
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request), fee(quote.fromToken, 7_500), ...swaps(quote), positive(request)] });
    assertSpend(quote, expected);
  });
  test.each([
    ["BASIC", (q: FullQuote) => [poolSwap(q.fromToken), rfqLeg(q, BigInt(500_000))], TARGET],
    ["V2", (q: FullQuote) => [v2(TARGET, q.fromToken, BigInt(1_000_000)), rfqLeg(q, BigInt(500_000))], TARGET],
    ["Maverick", (q: FullQuote) => [maverick(TARGET, q.fromToken, BigInt(1_000_000)), rfqLeg(q, BigInt(500_000))], TARGET],
    ["intermediate V3 leg", (q: FullQuote) => [v3Ppm(request, BigInt(500_000)), v3Ppm(request, BigInt(1_000_000), path(INTERMEDIATE, q.toToken))], TARGET],
    ["V3 path ends at intermediate", (q: FullQuote) => [v3Ppm(request, BigInt(500_000), path(q.fromToken, INTERMEDIATE)), rfqLeg(q, BigInt(500_000))], TARGET],
    ["pool-funded RFQ", (q: FullQuote) => [v2(TARGET, q.fromToken, BigInt(1_000_000)), rfqLeg(q, BigInt(500_000))], POOL],
  ] as const)("does not model %s", (_label, swaps, recipient) => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request, recipient), ...swaps(quote), positive(request)] });
    assertSpend(quote, "unmodeled");
  });
  test("rejects duplicate maker nonce in an otherwise exact mixed route", () => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request),
      rfqLeg(quote, BigInt(250_000)), v3Ppm(request, BigInt(500_000)), rfqLeg(quote, BigInt(375_000)), positive(request)] });
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({ actionsVerified: false, inputSpend: null });
    expect(() => validate(quote)).toThrow("unverified-actions");
  });
  test("extracts only the RFQ maker authorization in a mixed route", () => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request), rfqLeg(quote, BigInt(500_000)), v3(request), positive(request)] });
    assertSpend(quote, "exact");
    expect(rfqMakerAuthorizations(request, quote, TARGET)).toMatchObject([{ maker: MAKER, maxTakerAmount: BigInt(500_000), takerToken: quote.fromToken }]);
    expect(rfqMakerAuthorizations(request, quote, TARGET)).toHaveLength(1);
  });
  test("sums independent RFQ capacity without counting the same maker nonce twice", () => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    const rfq = (amount: bigint, nonce: bigint, maker: Address) => action("0xd92aadfb", rfqAbi,
      [TARGET, { permitted: { token: quote.toToken, amount }, nonce, deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) }, maker, "0x1234", quote.fromToken, quote.fromAmount / BigInt(2)]);
    const route = (second: bigint, nonce: bigint) => settlerData(quote.toToken, { actions: [transfer(request), rfq(BigInt(600), BigInt(4), MAKER), rfq(second, nonce, MAKER), positive(request)] });
    quote.transaction.data = route(BigInt(389), BigInt(5));
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({ actionsVerified: false, inputSpend: null });
    quote.transaction.data = route(BigInt(390), BigInt(5));
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(true);
    expect(() => validate(quote)).not.toThrow();
    quote.transaction.data = route(BigInt(390), BigInt(4));
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({ actionsVerified: false, inputSpend: null });
    expect(() => validate(quote)).toThrow("unverified-actions");
  });
  test.each([
    ["below", BigInt(499_999), false],
    ["equal", BigInt(500_000), true],
    ["above", BigInt(500_001), true],
  ] as const)("%s: requires RFQ-only maximum taker spend to cover the full reviewed input", (_label, secondMax, accepted) => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    const rfq = (makerAmount: bigint, nonce: bigint, maxTaker: bigint) => action("0xd92aadfb", rfqAbi,
      [TARGET, { permitted: { token: quote.toToken, amount: makerAmount }, nonce, deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) }, MAKER, "0x1234", quote.fromToken, maxTaker]);
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request),
      rfq(BigInt(600), BigInt(4), BigInt(500_000)), rfq(BigInt(500), BigInt(5), secondMax), positive(request)] });
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({ actionsVerified: accepted, inputSpend: accepted ? "exact" : "underfill" });
    if (accepted) expect(() => validate(quote)).not.toThrow();
    else expect(() => validate(quote)).toThrow("stale-quote");
  });
  test("accounts for a receive-token fee before comparing RFQ capacity with the reviewed minimum", () => {
    const input = { ...request, direction: "sell" as const };
    const quote = fixture(input);
    quote.fees.protocolFee = { token: quote.toToken, amount: BigInt(10) };
    const rfq = (capacity: bigint) => action("0xd92aadfb", rfqAbi, [TARGET,
      { permitted: { token: quote.toToken, amount: capacity }, nonce: BigInt(4), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) },
      MAKER, "0x1234", quote.fromToken, quote.fromAmount]);
    const route = (capacity: bigint) => settlerData(quote.toToken, { actions: [transfer(input), rfq(capacity), fee(quote.toToken, 10_000), positive(input)] });
    quote.transaction.data = route(BigInt(999));
    expect(swapExecutionMatches(input, quote, TARGET).actionsVerified).toBe(false);
    quote.transaction.data = route(BigInt(1000));
    expect(swapExecutionMatches(input, quote, TARGET).actionsVerified).toBe(true);
    expect(() => validate(quote, input)).not.toThrow();
  });
  test("rejects RFQ capacity eaten by an output fee despite a lower provider fee estimate", () => {
    const input = { ...request, direction: "sell" as const };
    const quote = fixture(input);
    quote.toAmount = BigInt(100_000);
    quote.minToAmount = BigInt(100_000);
    quote.fees.protocolFee = { token: quote.toToken, amount: BigInt(999) };
    const route = (capacity: bigint) => settlerData(quote.toToken, { minAmountOut: quote.minToAmount, actions: [transfer(input),
      action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: quote.toToken, amount: capacity }, nonce: BigInt(4), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) }, MAKER, "0x1234", quote.fromToken, quote.fromAmount]),
      fee(quote.toToken, 9989), positive(input, BigInt(100_001))] });
    quote.transaction.data = route(BigInt(100_999));
    expect(swapExecutionMatches(input, quote, TARGET).actionsVerified).toBe(false);
    expect(() => validate(quote, input)).toThrow("unverified-actions");
    quote.transaction.data = route(BigInt(101_009));
    expect(swapExecutionMatches(input, quote, TARGET).actionsVerified).toBe(true);
    expect(() => validate(quote, input)).not.toThrow();
  });
  test("rejects a maker amount reserved for balance-proportional encoding", () => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request),
      action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: quote.toToken, amount: (BigInt(1) << BigInt(256)) - BigInt(1) }, nonce: BigInt(4), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) }, MAKER, "0x1234", quote.fromToken, quote.fromAmount]),
      positive(request)] });
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(false);
    expect(() => validate(quote)).toThrow("unverified-actions");
  });
  test("rejects RFQ output sent directly to the taker because it cannot satisfy Settler's outer check", () => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request),
      action("0xd92aadfb", rfqAbi, [TAKER, { permitted: { token: quote.toToken, amount: quote.toAmount }, nonce: BigInt(4), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300) }, MAKER, "0x1234", quote.fromToken, quote.fromAmount]),
      positive(request)] });
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(false);
    expect(() => validate(quote)).toThrow("unverified-actions");
  });
  test.each([
    ["UNISWAPV2", "0x103b48be", v2Abi, (q: FullQuote) => [TARGET, q.fromToken, BigInt(1_000_000), POOL, BigInt(0)]],
    ["MAVERICKV2", "0x9b59756f", maverickAbi, (q: FullQuote) => [TARGET, q.fromToken, BigInt(1_000_000), POOL, true, -1]],
    ["UNISWAPV3", "0x8d68a156", v3Abi, (q: FullQuote) => [TARGET, BigInt(1_000_000), path(q.fromToken, q.toToken)]],
  ] as const)("zeros %s inner minimum while preserving all other calldata", (_kind, selector, abi, params) => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    const build = (minimum: bigint) => action(selector, abi, [...params(quote), minimum]);
    const actions = (minimum: bigint) => [transfer(request, selector === "0x8d68a156" ? TARGET : POOL), build(minimum), positive(request)];
    const zero = settlerData(quote.toToken, { actions: actions(BigInt(0)) });
    quote.transaction.data = settlerData(quote.toToken, { actions: actions(BigInt(1) << BigInt(200)) });
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(true);
    expect(validate(quote).swapCall.data).toBe(zero);
    quote.transaction.data = zero;
    expect(validate(quote).swapCall.data).toBe(zero);
  });
  test("zeros minimums in multiple actions without changing dynamic paths or outer slippage", () => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    const actions = (minimum: bigint) => [transfer(request, POOL),
      action("0x103b48be", v2Abi, [TARGET, quote.fromToken, BigInt(1_000_000), POOL, BigInt(0), minimum]),
      action("0x8d68a156", v3Abi, [TARGET, BigInt(1_000_000), path(quote.fromToken, quote.toToken), minimum]), positive(request)];
    quote.transaction.data = settlerData(quote.toToken, { actions: actions(BigInt(1) << BigInt(200)) });
    expect(validate(quote).swapCall.data).toBe(settlerData(quote.toToken, { actions: actions(BigInt(0)) }));
  });
  test.each([0, -1, 60] as const)("bounds RFQ validity with maker deadline offset %s seconds", (offset) => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    const makerDeadline = BigInt(Math.floor(NOW.getTime() / 1000) + offset);
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request),
      action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: quote.toToken, amount: BigInt(1000) }, nonce: BigInt(4), deadline: makerDeadline }, MAKER, "0x1234", quote.fromToken, quote.fromAmount]),
      positive(request)] });
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(true);
    if (offset <= 0) expect(() => validate(quote)).toThrow("stale-quote");
    else {
      const reviewed = validate(quote);
      expect(reviewed.executionDeadline).toBe(makerDeadline);
      expect(reviewed.expiresAt).toEqual(new Date(Number(makerDeadline) * 1000));
      expect(reviewed.permit.deadline).toBeGreaterThan(makerDeadline);
      expect(reviewed.swapCall.data).toBe(quote.transaction.data);
    }
  });
  test.each([
    [[300, 45], 45],
    [[45, 300], 45],
    [[300, 0], 0],
  ] as const)("uses the earliest deadline across multiple RFQ actions", (offsets, earliest) => {
    const quote = fixture();
    quote.fees.protocolFee = null;
    const rfqs = offsets.map((offset, index) => action("0xd92aadfb", rfqAbi, [TARGET,
      { permitted: { token: quote.toToken, amount: BigInt(1000) }, nonce: BigInt(4 + index), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + offset) },
      MAKER, "0x1234", quote.fromToken, quote.fromAmount / BigInt(2)]));
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request), ...rfqs, positive(request)] });
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(true);
    if (earliest === 0) expect(() => validate(quote)).toThrow("stale-quote");
    else expect(validate(quote).executionDeadline).toBe(BigInt(Math.floor(NOW.getTime() / 1000) + earliest));
  });
  test("matches the MAVERICKV2 selector to its ABI signature", () => {
    expect(toFunctionSelector("MAVERICKV2(address,address,uint256,address,bool,int32,uint256)")).toBe("0x9b59756f");
  });
  function verifyActions(actions: Hex[], expected: boolean, input: SwapReviewRequest = request, recipient: Address = TARGET, spend: "exact" | "underfill" | "unmodeled" | null = expected ? "exact" : null) {
    const quote = fixture(input);
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(input, recipient), ...actions] });
    expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({ calldataMatches: true, actionsVerified: expected, inputSpend: spend });
    if (expected) expect(() => validate(quote, input)).not.toThrow();
    else expect(() => validate(quote, input)).toThrow(spend === null ? "unverified-actions" : "stale-quote");
  }
  test.each([
    ["single-hop 64-byte path", (q: FullQuote) => path(q.fromToken, q.toToken), true, "exact"],
    ["two-hop 108-byte path via intermediate", (q: FullQuote) => path(q.fromToken, INTERMEDIATE, q.toToken), true, "exact"],
    ["intermediate start without any from-token swap", (q: FullQuote) => path(INTERMEDIATE, q.toToken), false, null],
    ["shorter than one hop", (q: FullQuote) => `0x${q.fromToken.slice(2)}${"00".repeat(43)}` as Hex, false, null],
    ["trailing byte", (q: FullQuote) => `${path(q.fromToken, q.toToken)}00` as Hex, false, null],
    ["truncated second hop", (q: FullQuote) => path(q.fromToken, INTERMEDIATE, q.toToken).slice(0, -2) as Hex, false, null],
    ["adjacent equal first", (q: FullQuote) => path(q.fromToken, q.fromToken, q.toToken), false, null],
    ["adjacent equal second", (q: FullQuote) => path(q.fromToken, INTERMEDIATE, INTERMEDIATE), false, null],
    ["returning the input token to Settler", (q: FullQuote) => path(q.fromToken, INTERMEDIATE, q.fromToken), false, "unmodeled"],
  ] as const)("validates V3 %s", (_label, route, expected, spend) => {
    const quote = fixture();
    verifyActions([v3(request, TARGET, route(quote))], expected, request, TARGET, spend);
  });
  test.each([
    ["BASIC", (token: Address) => poolSwap(token)],
    ["UNISWAPV2", (token: Address) => v2(TARGET, token, BigInt(1))],
    ["MAVERICKV2", (token: Address) => maverick(TARGET, token, BigInt(1))],
    ["V3 input", (token: Address) => v3(request, TARGET, path(token, INTERMEDIATE))],
    ["V3 middle", (token: Address) => v3(request, TARGET, path(swapTokens("buy", TOKEN).fromToken, token, INTERMEDIATE))],
    ["V3 output", (token: Address) => v3(request, TARGET, path(swapTokens("buy", TOKEN).fromToken, INTERMEDIATE, token))],
  ] as const)("forbids special swap tokens in %s", (_label, make) => {
    for (const token of [ZERO, PERMIT2_ADDRESS, TAKER, MAKER, TARGET]) {
      const input = { ...request, signerAddress: MAKER };
      verifyActions([v2(TARGET, swapTokens("buy", TOKEN).fromToken, BigInt(1), NEXT_POOL), make(token)], false, input);
    }
  });
  test.each([
    ["BASIC", poolSwap(INTERMEDIATE)],
    ["UNISWAPV2", v2(TARGET, INTERMEDIATE, BigInt(1))],
    ["MAVERICKV2", maverick(TARGET, INTERMEDIATE, BigInt(1))],
    ["V3", v3(request, TARGET, path(INTERMEDIATE, swapTokens("buy", TOKEN).toToken))],
  ])("accepts intermediate %s sell tokens only with a from-token swap", (_label, swap) => {
    verifyActions([v2(TARGET, swapTokens("buy", TOKEN).fromToken, BigInt(1), NEXT_POOL), swap], true, request, NEXT_POOL);
    verifyActions([swap], false);
  });
  test.each(["BASIC", "UNISWAPV3"] as const)("rejects partial %s spending when the input is held by Settler", (kind) => {
    const from = swapTokens("buy", TOKEN).fromToken;
    const swap = kind === "BASIC"
      ? action("0x38c9c147", basicAbi, [from, BigInt(999_999), POOL, BigInt(0), "0x12345678"])
      : action("0x8d68a156", v3Abi, [TARGET, BigInt(999_999), path(from, swapTokens("buy", TOKEN).toToken), BigInt(0)]);
    verifyActions([swap], false, request, TARGET, "underfill");
  });
  test.each(["UNISWAPV2", "MAVERICKV2"] as const)("validates %s prefunding and ppm edges", (kind) => {
    const make = kind === "UNISWAPV2" ? v2 : maverick;
    const from = swapTokens("buy", TOKEN).fromToken;
    const zero = make(TARGET, from, BigInt(0));
    verifyActions([zero], false);
    verifyActions([make(TARGET, from, BigInt(1))], false, request, TARGET, "underfill");
    verifyActions([make(TARGET, from, BigInt(1_000_000))], true);
    verifyActions([make(TARGET, from, BigInt(1_000_001))], false);
    const quote = fixture();
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request, POOL), zero] });
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(true);
    expect(() => validate(quote)).not.toThrow();
    verifyActions([make(POOL, from, BigInt(1), NEXT_POOL), zero], true, request, NEXT_POOL);
    verifyActions([zero, make(POOL, from, BigInt(1), NEXT_POOL), make(TARGET, from, BigInt(1), POOL)], false);
    verifyActions([make(TAKER, from, BigInt(1))], false);
    verifyActions([make(TARGET, from, BigInt(1), TAKER)], false);
    verifyActions([make(TARGET, from, BigInt(1), from)], false);
  });
  test.each([
    ["V2 to Maverick", v2(POOL, swapTokens("buy", TOKEN).fromToken, BigInt(1), NEXT_POOL), maverick(TARGET, INTERMEDIATE, BigInt(0), POOL)],
    ["Maverick to V2", maverick(POOL, swapTokens("buy", TOKEN).fromToken, BigInt(1), NEXT_POOL), v2(TARGET, INTERMEDIATE, BigInt(0), POOL)],
  ])("accepts forward recipient chains: %s", (_label, first, second) => {
    verifyActions([first, second], true, request, NEXT_POOL);
  });
  test.each(["BASIC", "UNISWAPV2", "MAVERICKV2"] as const)("rejects %s forbidden pools while allowing intermediate swap tokens", (kind) => {
    const make = kind === "BASIC" ? (pool: Address) => poolSwap(INTERMEDIATE, pool)
      : kind === "UNISWAPV2" ? (pool: Address) => v2(TARGET, INTERMEDIATE, BigInt(1), pool)
        : (pool: Address) => maverick(TARGET, INTERMEDIATE, BigInt(1), pool);
    for (const pool of [ZERO, TAKER, swapTokens("buy", TOKEN).fromToken, swapTokens("buy", TOKEN).toToken]) {
      verifyActions([v2(TARGET, swapTokens("buy", TOKEN).fromToken, BigInt(1), NEXT_POOL), make(pool)], false);
    }
  });
  test("does not model input spend for a non-router target with otherwise valid calldata", () => {
    const quote = fixture();
    quote.transaction.to = POOL;
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({
      targetMatchesRouter: false, calldataMatches: true, actionSelectors: ["0xc1fb425e", "0x38c9c147", "0x38c9c147", "0x8d68a156", "0x34ee90ca"],
      actionsVerified: false, inputSpend: null,
    });
  });
  test("accepts unknown swap actions bounded by the exact Permit2 input", () => {
    const quote = fixture();
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request), "0xaabbccdd"] });
    quote.fees.protocolFee = null;
    expect(swapExecutionMatches(request, quote, TARGET)).toEqual({ targetMatchesRouter: true, calldataMatches: true, actionSelectors: ["0xc1fb425e", "0xaabbccdd"], actionsVerified: true, inputSpend: "unmodeled" });
    expect(validate(quote).swapCall.data).toBe(quote.transaction.data);
  });
  function setWord(data: Hex, byteOffset: number, value: bigint): Hex {
    const start = 2 + byteOffset * 2;
    return `${data.slice(0, start)}${word(value)}${data.slice(start + 64)}` as Hex;
  }
  function setByte(data: Hex, byteOffset: number, value: string): Hex {
    const start = 2 + byteOffset * 2;
    return `${data.slice(0, start)}${value}${data.slice(start + 2)}` as Hex;
  }
  test.each([
    ["transfer not first", (q: FullQuote) => { q.transaction.data = settlerData(q.toToken, { actions: [v3(request), transfer(request)] }); }],
    ["transfer not physically last", (q: FullQuote) => {
      const data = settlerData(q.toToken, { actions: [transfer(request), v3(request)] });
      const start = 2 + 260 * 2;
      const sentinel = data.slice(-228 * 2);
      q.transaction.data = `${data.slice(0, start)}${sentinel}${data.slice(start, -228 * 2)}` as Hex;
    }],
    ["wrong sentinel", (q: FullQuote) => { q.transaction.data = setWord(q.transaction.data, (q.transaction.data.length - 2) / 2 - 228, BigInt(196)); }],
    ["wrong signature offset", (q: FullQuote) => { q.transaction.data = setWord(q.transaction.data, (q.transaction.data.length - 2) / 2 - 32, BigInt(0xa0)); }],
    ["trailing byte", (q: FullQuote) => { q.transaction.data = `${q.transaction.data}00`; }],
    ["nonzero padding", (q: FullQuote) => { q.transaction.data = setByte(settlerData(q.toToken, { actions: [transfer(request), "0xaabbccdd"] }), 296, "01"); }],
    ["overlapping offsets", (q: FullQuote) => { q.transaction.data = setWord(q.transaction.data, 260, BigInt(160)); }],
    ["duplicate transfer", (q: FullQuote) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), transfer(request), v3(request)] }); }],
    ["noncanonical address word", (q: FullQuote) => { q.transaction.data = setByte(q.transaction.data, 4, "01"); }],
    ["wrong array offset", (q: FullQuote) => { q.transaction.data = setWord(q.transaction.data, 100, BigInt(0xc0)); }],
    ["too many actions", (q: FullQuote) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), ...Array(8).fill(v3(request))] }); }],
  ] as const)("rejects malformed layout: %s", (_label, change) => {
    const quote = fixture();
    change(quote);
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({ calldataMatches: false, actionSelectors: null, actionsVerified: false });
    expect(() => validate(quote)).toThrow("quote-rejected");
  });
  function changeUnknownPermit(quote: FullQuote, field: string, value: string) {
    const typed = quote.permit2?.eip712;
    if (!isRecord(typed) || !isRecord(typed.message) || !isRecord(typed.message.permitted)) throw new Error("Invalid test permit");
    typed.message.permitted[field] = value;
  }
  function unknownQuote() {
    const quote = fixture();
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request), "0xaf72634f"] });
    quote.fees.protocolFee = null;
    return quote;
  }
  test.each([
    ["spender", (q: FullQuote) => {
      const typed = q.permit2?.eip712;
      if (!isRecord(typed) || !isRecord(typed.message)) throw new Error("Invalid test permit");
      typed.message.spender = POOL;
    }],
    ["token", (q: FullQuote) => { changeUnknownPermit(q, "token", POOL); }],
    ["amount", (q: FullQuote) => { changeUnknownPermit(q, "amount", "1000001"); }],
  ] as const)("execution matcher rejects a mismatched permit %s without validatePermit2", (_label, change) => {
    const quote = unknownQuote();
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(true);
    change(quote);
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({
      targetMatchesRouter: true, calldataMatches: true, actionsVerified: false, inputSpend: null,
    });
  });
  test.each([1_000_000, BigInt(1_000_000)])("execution matcher accepts permit integer representation %s", (amount) => {
    const quote: FullQuote = unknownQuote();
    const typed = quote.permit2?.eip712;
    if (!isRecord(typed) || !isRecord(typed.message) || !isRecord(typed.message.permitted)) throw new Error("Invalid test permit");
    typed.message.permitted.amount = amount;
    typed.message.nonce = BigInt(4);
    typed.message.deadline = Math.floor(NOW.getTime() / 1000) + 900;
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(true);
    expect(validate(quote).fromAmount).toBe(request.fromAmount);
  });
  test("unknown action on a pool-funded route reports unmodeled rather than exact spend", () => {
    const quote = unknownQuote();
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request, POOL), poolSwap(quote.fromToken), "0xaf72634f"] });
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({ actionsVerified: true, inputSpend: "unmodeled" });
  });
  test("logs only unknown selectors and direction when admitting an unknown route", () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    try {
      const quote = unknownQuote();
      quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request), "0xaf72634f", "0xaf72634f", v3(request)] });
      validate(quote);
      expect(lines.map((line): unknown => JSON.parse(line))).toEqual([{
        schema: "home.observability.v2", level: "info", kind: "action-prepare", route: "/api/actions/prepare",
        code: "TRADE_UNKNOWN_ACTIONS_ADMITTED", outcome: "accepted", durationMs: 0,
        unknownSelectors: ["0xaf72634f"], direction: "buy",
      }]);
      lines.length = 0;
      validate(fixture());
      expect(lines).toEqual([]);
      quote.transaction.data = setWord(quote.transaction.data, 4, BigInt(POOL));
      expect(() => validate(quote)).toThrow();
      expect(lines).toEqual([]);
    } finally {
      setObservabilityLogWriterForTests();
    }
  });
  test.each([
    ["recipient", (q: FullQuote) => { q.transaction.data = setWord(q.transaction.data, 4, BigInt(POOL)); }],
    ["buy token", (q: FullQuote) => { q.transaction.data = setWord(q.transaction.data, 36, BigInt(POOL)); }],
    ["minimum", (q: FullQuote) => { q.transaction.data = setWord(q.transaction.data, 68, BigInt(0)); }],
    ["different minimum", (q: FullQuote) => { q.transaction.data = setWord(q.transaction.data, 68, BigInt(989)); }],
    ["router", (q: FullQuote) => { q.transaction.to = POOL; }],
    ["gas", (q: FullQuote) => { q.transaction.gas = BigInt(3_000_001); }],
    ["permit token", (q: FullQuote) => { changeUnknownPermit(q, "token", POOL); }],
    ["permit amount", (q: FullQuote) => { changeUnknownPermit(q, "amount", "1000001"); }],
    ["known rejected action", (q: FullQuote) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), "0xaf72634f", v3(request, TAKER)] }); }],
    ["forbidden BASIC call", (q: FullQuote) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), "0xaf72634f", action("0x38c9c147", basicAbi, [q.fromToken, BigInt(1_000_000), POOL, BigInt(36), `0x095ea7b3${addressWord(POOL)}${word(123)}`])] }); }],
  ] as const)("unknown actions cannot bypass %s", (_label, change) => {
    const quote = unknownQuote();
    change(quote);
    expect(() => validate(quote)).toThrow();
  });
  function vip(input: SwapReviewRequest, minBuyAmount = BigInt(0)) {
    const fills: Hex = `0x${"12".repeat(73)}`;
    const abi = parseAbiParameters("address recipient, ((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit, bool feeOnTransfer, uint256 hashMul, uint256 hashMod, bytes fills, bytes sig, uint256 amountOutMin");
    const encoded = action("0x931997d3", abi, [TARGET, { permitted: { token: swapTokens(input.direction, TOKEN).fromToken, amount: input.fromAmount }, nonce: BigInt(4), deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 900) }, false, BigInt(2), BigInt(3), fills, "0x", minBuyAmount]);
    const unsigned = encoded.slice(0, -64);
    if (!isHex(unsigned)) throw new Error("Invalid test VIP");
    return unsigned;
  }
  test.each([
    ["VIP at index one alone", (input: SwapReviewRequest) => [transfer(input), vip(input)]],
    ["second VIP at index one", (input: SwapReviewRequest) => [vip(input), vip(input)]],
  ] as const)("execution matcher rejects duplicate permit layout: %s", (_label, actions) => {
    const input: SwapReviewRequest = { ...request, direction: "sell" };
    const quote = fixture(input);
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: actions(input) });
    expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({
      targetMatchesRouter: true, calldataMatches: false, actionSelectors: null, actionsVerified: false,
    });
  });
  test("execution matcher rejects a VIP token mismatch even with unknown later actions", () => {
    const input: SwapReviewRequest = { ...request, direction: "sell" };
    const quote = fixture(input);
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [vip(input), "0xaf72634f"] });
    expect(swapExecutionMatches(input, quote, TARGET).actionsVerified).toBe(true);
    quote.transaction.data = settlerData(quote.toToken, { actions: [setWord(vip(input), 36, BigInt(POOL)), "0xaf72634f"] });
    expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({
      calldataMatches: true, actionsVerified: false, inputSpend: null,
    });
  });
  test("execution matcher rejects VIP trailing zeros beyond the padded fills end", () => {
    const input: SwapReviewRequest = { ...request, direction: "sell" };
    const quote = fixture(input);
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [`${vip(input)}${"00".repeat(32)}`] });
    expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({
      calldataMatches: false, actionSelectors: null, actionsVerified: false,
    });
  });
  test("decodes sell UNISWAPV4_VIP with the existing execute header and rewrites its inner minimum", () => {
    const input: SwapReviewRequest = { ...request, direction: "sell" };
    const quote = fixture(input);
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [vip(input, BigInt(980))] });
    expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({ calldataMatches: true, actionsVerified: true, inputSpend: "exact", actionSelectors: ["0x931997d3"] });
    const reviewed = validate(quote, input);
    expect(reviewed.swapCall.data).toBe(settlerData(quote.toToken, { actions: [vip(input)] }));
    expect(reviewed.executionDeadline).toBe(BigInt(Math.floor(NOW.getTime() / 1000) + 900));
  });
  test("VIP sells retain the outer recipient, receive token and minimum binding", () => {
    const input: SwapReviewRequest = { ...request, direction: "sell" };
    for (const field of ["recipient", "buyToken", "minAmountOut"]) {
      const quote = fixture(input);
      quote.fees.protocolFee = null;
      quote.transaction.data = settlerData(quote.toToken, { actions: [vip(input)],
        ...(field === "recipient" ? { recipient: POOL } : field === "buyToken" ? { buyToken: POOL } : { minAmountOut: BigInt(0) }) });
      expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({ calldataMatches: false, actionsVerified: false });
      expect(() => validate(quote, input)).toThrow("quote-rejected");
    }
  });
  test.each([4, 36, 68, 100, 132, 164, 260, 292, 324, 356, 483])("rejects invalid VIP field at byte %s", (offset) => {
    const input: SwapReviewRequest = { ...request, direction: "sell" };
    const quote = fixture(input);
    quote.fees.protocolFee = null;
    const first = vip(input);
    const mutated = offset === 483 ? setByte(first, offset, "01") : setWord(first, offset, BigInt(1_000_001));
    quote.transaction.data = settlerData(quote.toToken, { actions: [mutated] });
    expect(() => validate(quote, input)).toThrow();
  });
  test("unknown actions do not skip RFQ maker deadlines or authorizations", () => {
    const quote = unknownQuote();
    const rfq = rfqLeg(quote, request.fromAmount, BigInt(5), BigInt(500));
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request), "0xaf72634f", rfq] });
    expect(validate(quote).executionDeadline).toBe(BigInt(Math.floor(NOW.getTime() / 1000) + 300));
    expect(rfqMakerAuthorizations(request, quote, TARGET)).toHaveLength(1);
  });
  const actionRejections: Array<[string, (quote: FullQuote) => void]> = [
    ["transfer token", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request, TARGET, q.toToken), v3(request)] }); q.fees.protocolFee = null; }],
    ["transfer amount", (q) => { q.transaction.data = setWord(q.transaction.data, (q.transaction.data.length - 2) / 2 - 128, BigInt(1)); }],
    ["transfer nonce", (q) => { q.transaction.data = setWord(q.transaction.data, (q.transaction.data.length - 2) / 2 - 96, BigInt(3)); }],
    ["transfer deadline", (q) => { q.transaction.data = setWord(q.transaction.data, (q.transaction.data.length - 2) / 2 - 64, BigInt(1)); }],
    ["transfer recipient", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request, FEE_TO), v3(request)] }); q.fees.protocolFee = null; }],
    ["fee token", (q) => { const a = defaultActions(request); a[1] = fee(q.toToken, 7500); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["fee absent", (q) => { q.fees.protocolFee = null; }],
    ["fee declared without fee action", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), v3(request)] }); }],
    ["fee recipient special", (q) => { const a = defaultActions(request); a[1] = fee(q.fromToken, 7500, TAKER); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["fee offset", (q) => { const a = defaultActions(request); a[1] = action("0x38c9c147", basicAbi, [q.fromToken, BigInt(7500), q.fromToken, BigInt(0), `0xa9059cbb${addressWord(FEE_TO)}${word(123)}`]); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["fee transfer selector", (q) => { const a = defaultActions(request); a[1] = action("0x38c9c147", basicAbi, [q.fromToken, BigInt(7500), q.fromToken, BigInt(36), `0xdeadbeef${addressWord(FEE_TO)}${word(123)}`]); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["fee sum", (q) => { q.fees.protocolFee!.amount = BigInt(8501); }],
    ["fee ppm cap", (q) => { const a = defaultActions(request); a[1] = fee(q.fromToken, 50000); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["pool special", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), poolSwap(q.fromToken, TAKER)] }); q.fees.protocolFee = null; }],
    ["pool sell token", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), poolSwap(FEE_TO)] }); q.fees.protocolFee = null; }],
    ["pool ppm", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0x38c9c147", basicAbi, [q.fromToken, BigInt(0), POOL, BigInt(0), "0x12345678"])] }); q.fees.protocolFee = null; }],
    ["pool offset", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0x38c9c147", basicAbi, [q.fromToken, BigInt(1), POOL, BigInt(36), "0x12345678"])] }); q.fees.protocolFee = null; }],
    ["pool calldata", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0x38c9c147", basicAbi, [q.fromToken, BigInt(1), POOL, BigInt(0), "0x1234"])] }); q.fees.protocolFee = null; }],
    ["v2 recipient", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0x103b48be", v2Abi, [TAKER, q.fromToken, BigInt(1), POOL, BigInt(0), BigInt(0)])] }); q.fees.protocolFee = null; }],
    ["v2 pool", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0x103b48be", v2Abi, [TARGET, q.fromToken, BigInt(1), TAKER, BigInt(0), BigInt(0)])] }); q.fees.protocolFee = null; }],
    ["v2 sell token", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0x103b48be", v2Abi, [TARGET, FEE_TO, BigInt(1), POOL, BigInt(0), BigInt(0)])] }); q.fees.protocolFee = null; }],
    ["v2 ppm", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0x103b48be", v2Abi, [TARGET, q.fromToken, BigInt(0), POOL, BigInt(0), BigInt(0)])] }); q.fees.protocolFee = null; }],
    ["v2 excessive ppm", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0x103b48be", v2Abi, [TARGET, q.fromToken, BigInt(1_000_001), POOL, BigInt(0), BigInt(0)])] }); q.fees.protocolFee = null; }],
    ["v3 recipient", (q) => { const a = defaultActions(request); a[3] = v3(request, TAKER); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["v3 path length", (q) => { const a = defaultActions(request); a[3] = v3(request, TARGET, `0x${q.fromToken.slice(2)}000bb8${q.toToken.slice(2)}`); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["v3 path endpoints", (q) => { const a = defaultActions(request); a[3] = v3(request, TARGET, path(q.fromToken, q.fromToken)); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["v3 ppm", (q) => { const a = defaultActions(request); a[3] = action("0x8d68a156", v3Abi, [TARGET, BigInt(0), path(q.fromToken, q.toToken), BigInt(0)]); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["v3 invalid token", (q) => { const a = defaultActions(request); a[3] = v3(request, TARGET, path(FEE_TO, q.toToken)); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["positive token", (q) => { const a = defaultActions(request); a[4] = action("0x34ee90ca", slippageAbi, [FEE_TO, q.fromToken, BigInt(1001), BigInt(1)]); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["positive recipient", (q) => { const a = defaultActions(request); a[4] = positive(request, BigInt(1001), TAKER); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["positive expected", (q) => { const a = defaultActions(request); a[4] = positive(request, BigInt(999)); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["positive ppm", (q) => { const a = defaultActions(request); a[4] = action("0x34ee90ca", slippageAbi, [FEE_TO, q.toToken, BigInt(1001), BigInt(0)]); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["positive excessive ppm", (q) => { const a = defaultActions(request); a[4] = action("0x34ee90ca", slippageAbi, [FEE_TO, q.toToken, BigInt(1001), BigInt(1_000_001)]); q.transaction.data = settlerData(q.toToken, { actions: a }); }],
    ["no swap action", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), positive(request)] }); q.fees.protocolFee = null; }],
    ["rfq maker", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: q.toToken, amount: BigInt(1) }, nonce: BigInt(0), deadline: BigInt(1) }, TAKER, "0x1234", q.fromToken, q.fromAmount])] }); q.fees.protocolFee = null; }],
    ["rfq recipient", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0xd92aadfb", rfqAbi, [FEE_TO, { permitted: { token: q.toToken, amount: BigInt(1) }, nonce: BigInt(0), deadline: BigInt(1) }, MAKER, "0x1234", q.fromToken, q.fromAmount])] }); q.fees.protocolFee = null; }],
    ["rfq signature", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: q.toToken, amount: BigInt(1) }, nonce: BigInt(0), deadline: BigInt(1) }, MAKER, "0x", q.fromToken, q.fromAmount])] }); q.fees.protocolFee = null; }],
    ["rfq taker amount", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: q.toToken, amount: BigInt(1) }, nonce: BigInt(0), deadline: BigInt(1) }, MAKER, "0x1234", q.fromToken, q.fromAmount + BigInt(1)])] }); q.fees.protocolFee = null; }],
    ["rfq token", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: q.fromToken, amount: BigInt(1) }, nonce: BigInt(0), deadline: BigInt(1) }, MAKER, "0x1234", q.toToken, q.fromAmount])] }); q.fees.protocolFee = null; }],
    ["rfq taker token", (q) => { q.transaction.data = settlerData(q.toToken, { actions: [transfer(request), action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: q.toToken, amount: BigInt(1) }, nonce: BigInt(0), deadline: BigInt(1) }, MAKER, "0x1234", q.toToken, q.fromAmount])] }); q.fees.protocolFee = null; }],
  ];
  test.each(actionRejections)("rejects action mismatch: %s", (_label, change) => {
    const quote = fixture();
    change(quote);
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({ calldataMatches: true, actionsVerified: false });
    expect(() => validate(quote)).toThrow("unverified-actions");
  });
  test("rejects sell fee outside the quote tolerance", () => {
    const input = { ...request, direction: "sell" as const };
    const quote = fixture(input);
    quote.toAmount = BigInt(833486);
    quote.minToAmount = BigInt(825152);
    quote.fees.protocolFee!.amount = BigInt(1300);
    quote.transaction.data = settlerData(quote.toToken, { minAmountOut: quote.minToAmount, actions: [transfer(input), poolSwap(quote.fromToken), positive(input, BigInt(835005)), fee(quote.toToken, 500), fee(quote.toToken, 1000)] });
    expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({ calldataMatches: true, actionsVerified: false });
    expect(() => validate(quote, input)).toThrow("unverified-actions");
  });
  const basicCallRejections: Array<[string, Hex, bigint, boolean]> = [
    ["taker aligned", `0x12345678${addressWord(TAKER)}` as Hex, BigInt(0), false],
    ["taker unaligned", `0x12345678aa${TAKER.slice(2)}${"00".repeat(31)}` as Hex, BigInt(0), false],
    ["signer mixed case", `0x12345678${SIGNER.slice(2).toUpperCase()}${"00".repeat(12)}` as Hex, BigInt(0), true],
    ["Permit2 mixed case", `0x12345678${PERMIT2_ADDRESS.slice(2).toUpperCase()}${"00".repeat(12)}` as Hex, BigInt(0), false],
    ...[
      "0xa9059cbb", "0x23b872dd", "0x095ea7b3", "0x39509351", "0xd505accf", "0x8fcbaf0c",
      "0x42842e0e", "0xb88d4fde", "0xf242432a", "0x2eb2c2d6", "0xa22cb465",
    ].map((selector): [string, Hex, bigint, boolean] => [`forbidden selector ${selector}`, `${selector}${"00".repeat(64)}` as Hex, BigInt(36), false]),
    ...[BigInt(1), BigInt(2), BigInt(3)].map((offset): [string, Hex, bigint, boolean] => [
      `offset ${offset} overlaps selector`, `0x12345678${"00".repeat(64)}`, offset, false,
    ]),
  ];
  test.each(basicCallRejections)("rejects BASIC pool call %s", (_label, data, offset, hasSigner) => {
    const input = hasSigner ? { ...request, signerAddress: SIGNER } : request;
    const quote = fixture(input);
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [
      transfer(input, POOL), action("0x38c9c147", basicAbi, [quote.fromToken, BigInt(1_000_000), POOL, offset, data]),
    ] });
    expect(swapExecutionMatches(input, quote, TARGET)).toMatchObject({ calldataMatches: true, actionsVerified: false });
    let caught: unknown;
    try { validate(quote, input); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(TradePreparationError);
    expect((caught as TradePreparationError).reason).toBe("unverified-actions");
  });
  test("accepts a BASIC pool call with a zero patch offset and a harmless selector", () => {
    verifyActions([action("0x38c9c147", basicAbi, [swapTokens("buy", TOKEN).fromToken, BigInt(1_000_000), POOL, BigInt(0), "0x12345678"])], true);
  });
  test("accepts transfer to a BASIC swap pool", () => {
    const quote = fixture();
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request, POOL), poolSwap(quote.fromToken)] });
    quote.fees.protocolFee = null;
    expect(() => validate(quote)).not.toThrow();
  });
  test("accepts observed sell fee tolerance", () => {
    const input = { ...request, direction: "sell" as const };
    const quote = fixture(input);
    quote.toAmount = BigInt(833486);
    quote.minToAmount = BigInt(825152);
    quote.fees.protocolFee!.amount = BigInt(1252);
    quote.transaction.data = settlerData(quote.toToken, { minAmountOut: quote.minToAmount, actions: [transfer(input), poolSwap(quote.fromToken), positive(input, BigInt(835005)), fee(quote.toToken, 500), fee(quote.toToken, 1000)] });
    expect(() => validate(quote, input)).not.toThrow();
  });
  test("reports null selectors when outer calldata cannot be decoded", () => {
    const quote = fixture();
    quote.transaction.data = "0xdeadbeef";
    expect(swapExecutionMatches(request, quote, TARGET)).toEqual({ targetMatchesRouter: true, calldataMatches: false, actionSelectors: null, actionsVerified: false, inputSpend: null });
  });
  test("reports no input-spend result when outer calldata mismatches", () => {
    const quote = fixture();
    quote.transaction.data = settlerData(quote.toToken, { recipient: FEE_TO });
    expect(swapExecutionMatches(request, quote, TARGET)).toMatchObject({ calldataMatches: false, actionsVerified: false, inputSpend: null });
    expect(() => validate(quote)).toThrow("quote-rejected");
  });
  test.each([false, true])("preserves insufficient-balance before action validation with simulationIncomplete=%s", (simulationIncomplete) => {
    const quote: FullQuote = fixture();
    quote.issues = { ...quote.issues, balance: { token: quote.fromToken, currentBalance: BigInt(0), requiredBalance: quote.fromAmount }, simulationIncomplete };
    expect(() => validate(quote)).toThrow("insufficient-balance");
  });

  const rejectCases: Array<[string, () => SwapQuote, string]> = [
    ["no liquidity", () => ({ liquidityAvailable: false }), "no-liquidity"],
    ["wrong token", () => ({ ...fixture(), fromToken: TAKER }), "quote-rejected"],
    ["reversed tokens", () => ({ ...fixture(), fromToken: fixture().toToken, toToken: fixture().fromToken }), "quote-rejected"],
    ["wrong amount", () => ({ ...fixture(), fromAmount: BigInt(3) }), "quote-rejected"],
    ["zero output", () => ({ ...fixture(), toAmount: BigInt(0) }), "below-minimum"],
    ["min exceeds output", () => ({ ...fixture(), minToAmount: BigInt(1001) }), "quote-rejected"],
    ["slippage floor", () => ({ ...fixture(), minToAmount: BigInt(989) }), "quote-rejected"],
    ["stale block", () => ({ ...fixture(), blockNumber: BigInt(969) }), "stale-quote"],
    ["ahead block", () => ({ ...fixture(), blockNumber: BigInt(1003) }), "stale-quote"],
    ["balance issue", () => ({ ...fixture(), issues: { ...fixture().issues, balance: { token: TAKER, currentBalance: BigInt(0), requiredBalance: BigInt(1) }, simulationIncomplete: true } }), "insufficient-balance"],
    ["simulation incomplete", () => ({ ...fixture(), issues: { ...fixture().issues, simulationIncomplete: true } }), "quote-rejected"],
    ["simulation missing", () => ({ ...fixture(), issues: { ...fixture().issues, simulationIncomplete: undefined as never } }), "quote-rejected"],
    ["permit absent", () => ({ ...fixture(), permit2: null }), "quote-rejected"],
    ["bad domain", () => changedPermit((p) => { p.domain.name = "Other"; }), "quote-rejected"],
    ["extra domain key", () => changedPermit((p) => { Object.assign(p.domain, { version: "1" }); }), "quote-rejected"],
    ["extra permit key", () => changedPermit((p) => { Object.assign(p.message, { witness: "0x00" }); }), "quote-rejected"],
    ["wrong permit field type", () => changedPermit((p) => { p.types.PermitTransferFrom[0].type = "address"; }), "quote-rejected"],
    ["zero permit spender", () => changedPermit((p) => { p.message.spender = "0x0000000000000000000000000000000000000000"; }), "quote-rejected"],
    ["wrong chain", () => changedPermit((p) => { p.domain.chainId = 1; }), "quote-rejected"],
    ["wrong verifying contract", () => changedPermit((p) => { p.domain.verifyingContract = TAKER; }), "quote-rejected"],
    ["wrong hash", () => ({ ...fixture(), permit2: { ...fixture().permit2, hash: `0x${"aa".repeat(32)}` } }), "quote-rejected"],
    ["expired", () => changedPermit((p) => { p.message.deadline = String(Math.floor(NOW.getTime() / 1000)); }), "quote-rejected"],
    ["excess deadline", () => changedPermit((p) => { p.message.deadline = String(Math.floor(NOW.getTime() / 1000) + 1801); }), "quote-rejected"],
    ["wrong permit token", () => changedPermit((p) => { p.message.permitted.token = TAKER; }), "quote-rejected"],
    ["wrong permit amount", () => changedPermit((p) => { p.message.permitted.amount = "1"; }), "quote-rejected"],
    ["different spender", () => {
      const q = fixture(); q.transaction.to = TAKER; return q;
    }, "quote-rejected"],
    ["target differs from router with matching permit spender", () => fixture(request, "0x4444444444444444444444444444444444444444"), "quote-rejected"],
    ["wrong allowance spender", () => ({ ...fixture(), issues: { ...fixture().issues, allowance: { spender: TAKER, currentAllowance: BigInt(0) } } }), "quote-rejected"],
    ["nonzero value", () => ({ ...fixture(), transaction: { ...fixture().transaction, value: BigInt(1) } }), "quote-rejected"],
    ...[PERMIT2_ADDRESS, BASE_USDC_ADDRESS.toLowerCase() as Address, swapTokens("buy", TOKEN).toToken, "0x0000000000000000000000000000000000000000" as Address].map((target): [string, () => SwapQuote, string] =>
      [`forbidden target ${target}`, () => ({ ...fixture(), transaction: { ...fixture().transaction, to: target } }), "quote-rejected"]),
    ["empty data", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: "0x" } }), "quote-rejected"],
    ["wrong selector", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: `0xdeadbeef${fixture().transaction.data.slice(10)}` } }), "quote-rejected"],
    ["trailing bytes", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: `${fixture().transaction.data}00` } }), "quote-rejected"],
    ["undecodable data", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: "0x1fff991f" } }), "quote-rejected"],
    ["wrong recipient", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: settlerData(swapTokens("buy", TOKEN).toToken, { recipient: TARGET }) } }), "quote-rejected"],
    ["wrong buy token", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: settlerData(swapTokens("buy", TOKEN).toToken, { buyToken: swapTokens("buy", TOKEN).fromToken }) } }), "quote-rejected"],
    ["low minimum output", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: settlerData(swapTokens("buy", TOKEN).toToken, { minAmountOut: BigInt(989) }) } }), "quote-rejected"],
    ["minimum above reviewed minimum", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: settlerData(swapTokens("buy", TOKEN).toToken, { minAmountOut: BigInt(991) }) } }), "quote-rejected"],
    ["minimum above quoted output", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: settlerData(swapTokens("buy", TOKEN).toToken, { minAmountOut: BigInt(1001) }) } }), "quote-rejected"],
    ["zero actions", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: settlerData(swapTokens("buy", TOKEN).toToken, { actions: [] }) } }), "quote-rejected"],
    ["short action", () => ({ ...fixture(), transaction: { ...fixture().transaction, data: settlerData(swapTokens("buy", TOKEN).toToken, { actions: ["0xaabb"] }) } }), "quote-rejected"],
    ["zero gas", () => ({ ...fixture(), transaction: { ...fixture().transaction, gas: BigInt(0) } }), "quote-rejected"],
    ["excess gas", () => ({ ...fixture(), transaction: { ...fixture().transaction, gas: BigInt(3_000_001) } }), "quote-rejected"],
  ];
  test.each(rejectCases)("rejects %s", (_label, make, reason) => {
    expect(() => validate(make())).toThrow(reason);
  });
  test.each(["0x0000000000000000000000000000000000000000", PERMIT2_ADDRESS, swapTokens("buy", TOKEN).fromToken, swapTokens("buy", TOKEN).toToken, "0xabc"] as Address[])("rejects invalid swap router %s", (swapRouter) => {
    expect(() => validate(fixture(), request, swapRouter)).toThrow("quote-rejected");
    expect(() => checkQuoteCompatibility({ request, quote: fixture(), now: NOW, currentBlockNumber: BigInt(1000), swapRouter })).toThrow("quote-rejected");
  });
  test.each([0, 301, 1.2])("rejects invalid slippage %s", (slippageBps) => {
    expect(() => validate(fixture(), { ...request, slippageBps })).toThrow("invalid-request");
  });
  const executionStateCases = new Set(["balance issue", "simulation incomplete", "simulation missing"]);
  test.each(rejectCases.filter(([label]) => !executionStateCases.has(label)))("compatibility check rejects %s independently of execution state", (_label, make, reason) => {
    const quote = make();
    if (quote.liquidityAvailable) quote.issues = { ...quote.issues, balance: { token: quote.fromToken, currentBalance: BigInt(0), requiredBalance: quote.fromAmount }, simulationIncomplete: true };
    expect(() => checkQuoteCompatibility({ request, quote, now: NOW, currentBlockNumber: BigInt(1000), swapRouter: TARGET })).toThrow(reason);
  });
  test("compatibility check accepts an unfunded but otherwise valid quote", () => {
    const quote = fixture();
    quote.issues = { ...quote.issues, balance: { token: quote.fromToken, currentBalance: BigInt(0), requiredBalance: quote.fromAmount }, simulationIncomplete: true } as never;
    expect(() => checkQuoteCompatibility({ request, quote, now: NOW, currentBlockNumber: BigInt(1000), swapRouter: TARGET })).not.toThrow();
  });
});

const makerAccount = privateKeyToAccount(`0x${"12".repeat(32)}`);
const otherMaker = privateKeyToAccount(`0x${"34".repeat(32)}`);
const makerAddress = makerAccount.address.toLowerCase() as Address;
const rfqPermit = (quote: FullQuote) => ({
  permitted: { token: quote.toToken, amount: BigInt(1000) }, nonce: BigInt(260),
  deadline: BigInt(Math.floor(NOW.getTime() / 1000) + 300),
});
function witnessData(quote: FullQuote, override: { counterparty?: Address; amount?: bigint; spender?: Address } = {}) {
  return {
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
      permitted: rfqPermit(quote).permitted, nonce: rfqPermit(quote).nonce, deadline: rfqPermit(quote).deadline,
      spender: override.spender ?? TARGET,
      consideration: { token: quote.fromToken, amount: override.amount ?? quote.fromAmount, counterparty: override.counterparty ?? TAKER, partialFillAllowed: true },
    },
  } as const;
}
function rfqQuote(signature: Hex, maker: Address = makerAddress) {
  const quote = fixture();
  quote.fees.protocolFee = null;
  quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request),
    action("0xd92aadfb", rfqAbi, [TARGET, rfqPermit(quote), maker, signature, quote.fromToken, quote.fromAmount]), positive(request)] });
  return quote;
}
function makerRead(maker: Address, options: { code?: unknown; result?: unknown; bitmap?: unknown; balance?: unknown; allowance?: unknown; fail?: string } = {}) {
  const calls: Array<[string, readonly unknown[]]> = [];
  const read = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    calls.push([method, params]);
    expect(params.at(-1)).toBe("0x3e8");
    if (options.fail === method) throw new Error("RPC error");
    if (method === "eth_getCode") {
      expect(params[0]).toBe(maker);
      return options.code ?? "0x";
    }
    const call = params[0] as { to: string; data: string };
    if (call.to === PERMIT2_ADDRESS) {
      expect(call.data).toBe(`0x4fe02b44${addressWord(maker)}${word(1)}`);
      return options.bitmap ?? `0x${word(0)}`;
    }
    if (call.to === swapTokens("buy", TOKEN).toToken) {
      if (options.fail === call.data.slice(0, 10)) throw new Error("RPC error");
      if (call.data.slice(0, 10) === "0x70a08231") {
        expect(call.data).toBe(encodeFunctionData({ abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [maker] }));
        return options.balance ?? `0x${word(1000)}`;
      }
      expect(call.data).toBe(encodeFunctionData({ abi: parseAbi(["function allowance(address,address) view returns (uint256)"]), functionName: "allowance", args: [maker, PERMIT2_ADDRESS] }));
      return options.allowance ?? `0x${word(1000)}`;
    }
    expect(call.to).toBe(maker);
    expect(call.data.slice(0, 10)).toBe("0x1626ba7e");
    return "result" in options ? options.result : `0x1626ba7e${"0".repeat(56)}`;
  };
  return { read, calls };
}

describe("RFQ maker authorization", () => {
  test("matches Settler's Consideration typehash and extracts no RFQ from a V3 quote", () => {
    expect(keccak256(stringToHex("Consideration(address token,uint256 amount,address counterparty,bool partialFillAllowed)")))
      .toBe("0x7d806873084f389a66fd0315dead7adaad8ae6e8b6cf9fb0d3db61e5a91c3ffa");
    expect(rfqMakerAuthorizations(request, fixture(), TARGET)).toEqual([]);
  });
  test.each(["65-byte", "64-byte compact"] as const)("accepts a valid %s EOA witness and unused maker nonce at the pinned block", async (format) => {
    const quote = fixture();
    const signature = await makerAccount.signTypedData(witnessData(quote));
    const compact = `${signature.slice(0, 66)}${(BigInt(`0x${signature.slice(66, 130)}`) | (signature.slice(-2) === "1c" ? BigInt(1) << BigInt(255) : BigInt(0))).toString(16).padStart(64, "0")}` as Hex;
    const rfq = rfqQuote(format === "65-byte" ? signature : compact);
    expect(validate(rfq).executionDeadline).toBe(rfqPermit(rfq).deadline);
    const auths = rfqMakerAuthorizations(request, rfq, TARGET);
    expect(auths).toMatchObject([{ maker: makerAddress, permit: rfqPermit(rfq), makerSig: format === "65-byte" ? signature : compact,
      takerToken: rfq.fromToken, maxTakerAmount: rfq.fromAmount }]);
    expect(auths[0]!.digest).toBe(hashTypedData(witnessData(rfq)));
    const { read, calls } = makerRead(makerAddress);
    await verifyRfqMakerAuthorizations(auths, read, "0x3e8");
    expect(calls.map(([method]) => method)).toEqual(["eth_getCode", "eth_call", "eth_call", "eth_call"]);
  });
  test.each([
    ["malformed 0x1234", async () => "0x1234" as Hex],
    ["a different maker key", async (quote: FullQuote) => otherMaker.signTypedData(witnessData(quote))],
    ["wrong counterparty", async (quote: FullQuote) => makerAccount.signTypedData(witnessData(quote, { counterparty: FEE_TO }))],
    ["wrong amount", async (quote: FullQuote) => makerAccount.signTypedData(witnessData(quote, { amount: BigInt(999_999) }))],
    ["wrong spender", async (quote: FullQuote) => makerAccount.signTypedData(witnessData(quote, { spender: FEE_TO }))],
  ] as const)("rejects %s instead of reviewing a malformed EOA RFQ", async (_label, makeSignature) => {
    const quote = rfqQuote(await makeSignature(fixture()));
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(true);
    const { read } = makerRead(makerAddress);
    await expect(verifyRfqMakerAuthorizations(rfqMakerAuthorizations(request, quote, TARGET), read, "0x3e8"))
      .rejects.toMatchObject({ reason: "unverified-actions" });
  });
  test.each(["zero maker permit amount", "zero max taker amount"] as const)("rejects %s in structural RFQ validation", (defect) => {
    const quote = fixture();
    const permit = rfqPermit(quote);
    quote.fees.protocolFee = null;
    quote.transaction.data = settlerData(quote.toToken, { actions: [transfer(request),
      action("0xd92aadfb", rfqAbi, [TARGET, {
        ...permit, permitted: { ...permit.permitted, amount: defect === "zero maker permit amount" ? BigInt(0) : permit.permitted.amount },
      }, makerAddress, "0x1234", quote.fromToken, defect === "zero max taker amount" ? BigInt(0) : quote.fromAmount]), positive(request)] });
    expect(swapExecutionMatches(request, quote, TARGET).actionsVerified).toBe(false);
    expect(() => validate(quote)).toThrow("unverified-actions");
  });
  test.each([
    ["insufficient output balance", { balance: `0x${word(999)}` }],
    ["insufficient Permit2 allowance", { allowance: `0x${word(999)}` }],
  ] as const)("rejects %s at the pinned block", async (_label, options) => {
    const quote = fixture();
    const rfq = rfqQuote(await makerAccount.signTypedData(witnessData(quote)));
    const { read } = makerRead(makerAddress, options);
    await expect(verifyRfqMakerAuthorizations(rfqMakerAuthorizations(request, rfq, TARGET), read, "0x3e8"))
      .rejects.toMatchObject({ reason: "stale-quote" });
  });
  test.each([
    ["balance read failure", { fail: "0x70a08231" }],
    ["allowance read failure", { fail: "0xdd62ed3e" }],
    ["malformed balance", { balance: "0x" }],
    ["malformed allowance", { allowance: "0x" }],
  ] as const)("fails closed on %s", async (_label, options) => {
    const quote = fixture();
    const rfq = rfqQuote(await makerAccount.signTypedData(witnessData(quote)));
    const { read } = makerRead(makerAddress, options);
    await expect(verifyRfqMakerAuthorizations(rfqMakerAuthorizations(request, rfq, TARGET), read, "0x3e8"))
      .rejects.toMatchObject({ reason: "provider-unavailable" });
  });
  test("sums several authorizations from one maker against its balance and allowance", async () => {
    const quote = fixture();
    const rfq = rfqQuote(await makerAccount.signTypedData(witnessData(quote)));
    const [auth] = rfqMakerAuthorizations(request, rfq, TARGET);
    const both = [auth!, auth!];
    await expect(verifyRfqMakerAuthorizations(both, makerRead(makerAddress).read, "0x3e8")).rejects.toMatchObject({ reason: "stale-quote" });
    const funded = makerRead(makerAddress, { balance: `0x${word(2000)}`, allowance: `0x${word(2000)}` });
    await verifyRfqMakerAuthorizations(both, funded.read, "0x3e8");
    expect(funded.calls.filter(([, params]) => (params[0] as { to?: string }).to === swapTokens("buy", TOKEN).toToken)).toHaveLength(2);
  });
  test("rejects a used maker nonce", async () => {
    const quote = fixture();
    const rfq = rfqQuote(await makerAccount.signTypedData(witnessData(quote)));
    const { read } = makerRead(makerAddress, { bitmap: `0x${word(BigInt(1) << BigInt(4))}` });
    await expect(verifyRfqMakerAuthorizations(rfqMakerAuthorizations(request, rfq, TARGET), read, "0x3e8"))
      .rejects.toMatchObject({ reason: "quote-rejected" });
  });
  test.each([true, false])("%s: checks a contract maker ERC-1271 result before its nonce", async (valid) => {
    const quote = rfqQuote("0x1234", MAKER);
    const auth = rfqMakerAuthorizations(request, quote, TARGET);
    const { read, calls } = makerRead(MAKER, valid ? { code: "0x6000" } : { code: "0x6000", result: `0x00000000${"0".repeat(56)}` });
    if (valid) await verifyRfqMakerAuthorizations(auth, read, "0x3e8");
    else await expect(verifyRfqMakerAuthorizations(auth, read, "0x3e8")).rejects.toMatchObject({ reason: "unverified-actions" });
    expect(calls.map(([method]) => method)).toEqual(valid ? ["eth_getCode", "eth_call", "eth_call", "eth_call", "eth_call"] : ["eth_getCode", "eth_call"]);
    expect((calls[1]![1][0] as { data: Hex }).data).toBe(encodeFunctionData({
      abi: parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]),
      functionName: "isValidSignature", args: [auth[0]!.digest, "0x1234"],
    }));
  });
  test.each([
    ["code transport failure", { fail: "eth_getCode" }],
    ["malformed code result", { code: "invalid" }],
    ["nonce transport failure", { fail: "eth_call" }],
    ["malformed nonce result", { bitmap: "0x" }],
    ["contract call transport failure, including a revert", { code: "0x6000", fail: "eth_call" }],
    ["malformed contract call result", { code: "0x6000", result: null }],
  ] as const)("maps %s to provider-unavailable", async (_label, options) => {
    const quote = fixture();
    const contract = "code" in options && options.code === "0x6000";
    const rfq = rfqQuote(await makerAccount.signTypedData(witnessData(quote)), contract ? MAKER : makerAddress);
    const { read } = makerRead(contract ? MAKER : makerAddress, options);
    await expect(verifyRfqMakerAuthorizations(rfqMakerAuthorizations(request, rfq, TARGET), read, "0x3e8"))
      .rejects.toMatchObject({ reason: "provider-unavailable" });
  });
});
