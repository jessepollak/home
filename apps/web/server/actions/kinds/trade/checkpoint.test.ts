import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, hashTypedData, parseAbiParameters, type AbiParameter } from "viem";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import type { Address, Hex } from "@/shared/trading/server-types";
import type { CdpSwapsClient, SwapQuote } from "./cdp-swaps";
import { acquisitionUsdc, checkpointExitCode, runSwapsCheckpoint } from "./checkpoint";
import { PERMIT2_ADDRESS } from "./permit2";
import { swapTokens, validateSwapQuote, type SwapDirection } from "./quote";

type FullQuote = Extract<SwapQuote, { liquidityAvailable: true }>;
const TOKEN: Address = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
const TAKER: Address = "0x1111111111111111111111111111111111111111";
const TARGET: Address = "0x3333333333333333333333333333333333333333";
const FEE_TO: Address = "0x6666666666666666666666666666666666666666";
const USDC = BASE_USDC_ADDRESS.toLowerCase();
const NOW = new Date("2026-10-19T12:00:00.000Z");
const BLOCK = BigInt(1000);
const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, "0");
const addressWord = (address: Address) => word(BigInt(address));
const action = (selector: Hex, abi: readonly AbiParameter[], values: readonly unknown[]): Hex =>
  `${selector}${encodeAbiParameters(abi, values).slice(2)}`;
const v3Abi = parseAbiParameters("address recipient, uint256 ppm, bytes path, uint256 amountOutMin");
const slippageAbi = parseAbiParameters("address recipient, address token, uint256 expectedAmount, uint256 maxPpm");
const basicAbi = parseAbiParameters("address sellToken, uint256 ppm, address pool, uint256 offset, bytes data");
const POOL: Address = "0x5555555555555555555555555555555555555555";
const rfqAbi = parseAbiParameters("address recipient, ((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit, address maker, bytes makerSig, address takerToken, uint256 maxTakerAmount");
const MAKER: Address = "0x7777777777777777777777777777777777777777";
function transferAction(fromToken: Address, fromAmount: bigint, deadline: number): Hex {
  return `0xc1fb425e${addressWord(TARGET)}${addressWord(fromToken)}${word(fromAmount)}${word(4)}${word(deadline)}${word(0xc0)}`;
}
function swapAction(fromToken: Address, toToken: Address): Hex {
  return action("0x8d68a156", v3Abi, [TARGET, BigInt(1_000_000), `${fromToken}00000000${"00".repeat(20)}${toToken.slice(2)}`, BigInt(0)]);
}
function poolSwapAction(token: Address): Hex {
  return action("0x38c9c147", basicAbi, [token, BigInt(1_000_000), POOL, BigInt(36), `0x12345678${"00".repeat(64)}`]);
}
function positiveAction(toToken: Address, toAmount: bigint): Hex {
  return action("0x34ee90ca", slippageAbi, [FEE_TO, toToken, toAmount, BigInt(1_000_000)]);
}
function settlerData(toToken: Address, minToAmount: bigint, actions: Hex[]): Hex {
  let offset = actions.length * 32;
  const elements = actions.slice(1).map((item) => {
    const bytes = (item.length - 2) / 2;
    const encoded = `${word(bytes)}${item.slice(2)}${"0".repeat((32 - bytes % 32) % 32 * 2)}`;
    const start = offset;
    offset += encoded.length / 2;
    return { encoded, start };
  });
  const offsets = [offset, ...elements.map((item) => item.start)];
  const first = actions[0];
  if (first === undefined) throw new Error("empty actions");
  return `0x1fff991f${addressWord(TAKER)}${addressWord(toToken)}${word(minToAmount)}${word(0xa0)}${word(0)}${word(actions.length)}${offsets.map(word).join("")}${elements.map((item) => item.encoded).join("")}${word(0xffff)}${first.slice(2)}`;
}

function fixture(direction: SwapDirection, token: Address, { fromAmount, toAmount, balance }: {
  fromAmount: bigint;
  toAmount: bigint;
  balance: bigint | null;
}): FullQuote {
  const { fromToken, toToken } = swapTokens(direction, token);
  const deadline = Math.floor(NOW.getTime() / 1000) + 900;
  const minToAmount = toAmount * BigInt(99) / BigInt(100);
  const eip712: Parameters<typeof hashTypedData>[0] = {
    domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    },
    primaryType: "PermitTransferFrom",
    message: { permitted: { token: fromToken, amount: fromAmount.toString() }, spender: TARGET, nonce: "4", deadline: String(deadline) },
  };
  const data = settlerData(toToken, minToAmount, [
    transferAction(fromToken, fromAmount, deadline),
    fromToken === toToken ? poolSwapAction(fromToken) : swapAction(fromToken, toToken),
    positiveAction(toToken, toAmount),
  ]);
  return {
    liquidityAvailable: true, fromToken, toToken, fromAmount, toAmount, minToAmount, blockNumber: BLOCK,
    fees: { gasFee: null, protocolFee: null },
    issues: { allowance: null, balance: balance === null ? null : { token: fromToken, currentBalance: BigInt(0), requiredBalance: balance }, simulationIncomplete: false },
    transaction: { to: TARGET, data, value: BigInt(0), gas: BigInt(100), gasPrice: BigInt(2) },
    permit2: { hash: hashTypedData(eip712), eip712 },
  };
}

function checkpoint({ token = TOKEN, sell = BigInt(1_000_000), deriveSellFromBuy = false, change }: {
  token?: Address;
  sell?: bigint;
  deriveSellFromBuy?: boolean;
  change?: (quote: FullQuote, direction: SwapDirection) => void;
} = {}) {
  const client: CdpSwapsClient = {
    async getPrice(request) {
      const direction = request.fromToken === request.toToken || request.fromToken !== USDC ? "sell" : "buy";
      return { ...fixture(direction, token, { fromAmount: request.fromAmount, toAmount: BigInt(1_000_000), balance: null }), gas: null, gasPrice: BigInt(2) };
    },
    async createQuote(request) {
      const direction = request.fromToken === request.toToken || request.fromToken !== USDC ? "sell" : "buy";
      const quote = fixture(direction, token, {
        fromAmount: request.fromAmount,
        toAmount: direction === "buy" ? BigInt(1_000_000) : BigInt(100_000),
        balance: direction === "sell" ? request.fromAmount : null,
      });
      change?.(quote, direction);
      return quote;
    },
  };
  return runSwapsCheckpoint({
    client, taker: TAKER, token, amounts: { buy: BigInt(100_000), sell }, now: NOW, deriveSellFromBuy,
    readSwapRouter: async () => TARGET, readBlockNumber: async () => BLOCK,
    read: async () => { throw new Error("unused"); },
  });
}

describe("acquisition USDC", () => {
  test("buffers the token shortfall by 10% and rounds the final USDC amount up once", () => {
    expect(acquisitionUsdc({ shortfall: BigInt(1_000_000), buy: { fromAmount: BigInt(100_000), toAmount: BigInt(1_000_000) } })).toBe(BigInt(110_000));
    expect(acquisitionUsdc({ shortfall: BigInt(1), buy: { fromAmount: BigInt(3), toAmount: BigInt(4) } })).toBe(BigInt(1));
    expect(acquisitionUsdc({ shortfall: BigInt(490), buy: { fromAmount: BigInt(101_000), toAmount: BigInt(52) } })).toBe(BigInt(1_046_904));
  });
  test.each([
    [BigInt(0), { fromAmount: BigInt(1), toAmount: BigInt(1) }],
    [BigInt(-1), { fromAmount: BigInt(1), toAmount: BigInt(1) }],
    [BigInt(1), null],
    [BigInt(1), { fromAmount: BigInt(0), toAmount: BigInt(1) }],
    [BigInt(1), { fromAmount: BigInt(-1), toAmount: BigInt(1) }],
    [BigInt(1), { fromAmount: BigInt(1), toAmount: BigInt(0) }],
    [BigInt(1), { fromAmount: BigInt(1), toAmount: BigInt(-1) }],
  ] as const)("rejects unusable shortfall %s or buy rate %s", (shortfall, buy) => {
    expect(acquisitionUsdc({ shortfall, buy })).toBeNull();
  });
});

describe("swap checkpoint acquisition readiness", () => {
  test.each(["buy", "sell"] as const)("fixture validates %s only after clearing its balance issue", (direction) => {
    const quote = fixture(direction, TOKEN, { fromAmount: BigInt(100_000), toAmount: BigInt(1_000_000), balance: BigInt(100_000) });
    const input = { request: { direction, token: TOKEN, fromAmount: quote.fromAmount, taker: TAKER, slippageBps: 100 }, now: NOW, currentBlockNumber: BLOCK, swapRouter: TARGET };
    expect(() => validateSwapQuote({ ...input, quote })).toThrow("insufficient-balance");
    expect(() => validateSwapQuote({ ...input, quote: { ...quote, issues: { ...quote.issues, balance: null } } })).not.toThrow();
  });
  test("classifies a balance-only sell shortfall within the cap as acquirable", async () => {
    const report = await checkpoint();
    expect(report.directions[1]).toMatchObject({ executionReadiness: "acquirable", acquisitionUsdc: "110000", balanceIssue: true });
    expect(checkpointExitCode(report)).toBe(0);
  });
  test("never marks a USDC sell leg acquirable", async () => {
    const report = await checkpoint({ token: BASE_USDC_ADDRESS, sell: BigInt(1_000_000) });
    expect(report.directions[0]).toMatchObject({ actionsVerified: true });
    expect(report.directions[1]).toMatchObject({ executionReadiness: "insufficient-balance", acquisitionUsdc: null });
  });
  test("uses only the missing token balance for the purchase", async () => {
    const report = await checkpoint({ change(quote, direction) {
      if (direction === "sell" && quote.issues.balance) quote.issues.balance.currentBalance = BigInt(250_000);
    } });
    expect(report.directions[1]).toMatchObject({ executionReadiness: "acquirable", acquisitionUsdc: "82500" });
    expect(checkpointExitCode(report)).toBe(0);
  });
  test("covers the full requested sell when the provider understates the required balance", async () => {
    const report = await checkpoint({ change(quote, direction) {
      if (direction === "sell" && quote.issues.balance) quote.issues.balance.requiredBalance = BigInt(1);
    } });
    expect(report.directions[1]).toMatchObject({ executionReadiness: "acquirable", acquisitionUsdc: "110000" });
  });
  test("does not price acquisition from a rejected buy quote", async () => {
    const report = await checkpoint({ change(quote, direction) {
      if (direction === "buy") quote.blockNumber = BLOCK - BigInt(31);
    } });
    expect(report.directions[0]).toMatchObject({ executionReadiness: "stale-quote" });
    expect(report.directions[1]).toMatchObject({ executionReadiness: "insufficient-balance", acquisitionUsdc: null });
    expect(checkpointExitCode(report)).toBe(2);
  });
  test("does not price acquisition from a buy quote whose RFQ maker is unverified", async () => {
    const report = await checkpoint({ change(quote, direction) {
      if (direction !== "buy") return;
      const deadline = Math.floor(NOW.getTime() / 1000) + 900;
      quote.transaction.data = settlerData(quote.toToken, quote.minToAmount, [
        transferAction(quote.fromToken, quote.fromAmount, deadline),
        action("0xd92aadfb", rfqAbi, [TARGET, { permitted: { token: quote.toToken, amount: quote.toAmount }, nonce: BigInt(4), deadline: BigInt(deadline) }, MAKER, "0x1234", quote.fromToken, quote.fromAmount]),
        positiveAction(quote.toToken, quote.toAmount),
      ]);
    } });
    expect(report.directions[0]).toMatchObject({ actionsVerified: false });
    expect(report.directions[1]?.executionReadiness).not.toBe("acquirable");
    expect(report.directions[1]).toMatchObject({ acquisitionUsdc: null });
    expect(checkpointExitCode(report)).toBe(2);
  });
  test("keeps an incomplete simulation short of acquirable", async () => {
    const report = await checkpoint({ change(quote, direction) {
      if (direction === "sell") quote.issues.simulationIncomplete = true;
    } });
    expect(report.directions[1]).toMatchObject({ executionReadiness: "insufficient-balance", acquisitionUsdc: null });
  });
  test("does not advertise acquisition when another quote check fails", async () => {
    const report = await checkpoint({ change(quote, direction) {
      if (direction === "sell") quote.transaction.to = "0x4444444444444444444444444444444444444444";
    } });
    expect(report.directions[1]).toMatchObject({ executionReadiness: "insufficient-balance", acquisitionUsdc: null, targetMatchesRouter: false });
    expect(checkpointExitCode(report)).toBe(2);
  });
  test("reports the acquisition cost above the cap without marking the sell acquirable", async () => {
    const report = await checkpoint({ sell: BigInt(10_000_000) });
    expect(report.directions[1]).toMatchObject({ executionReadiness: "insufficient-balance", acquisitionUsdc: "1100000" });
    expect(BigInt(report.directions[1]?.acquisitionUsdc ?? "0")).toBeGreaterThan(BigInt(1_000_000));
    expect(checkpointExitCode(report)).toBe(0);
  });
  test("never marks a buy leg with insufficient USDC as acquirable", async () => {
    const report = await checkpoint({ change(quote, direction) {
      if (direction === "buy") quote.issues.balance = { token: quote.fromToken, currentBalance: BigInt(0), requiredBalance: quote.fromAmount };
    } });
    expect(report.directions[0]).toMatchObject({ executionReadiness: "insufficient-balance", acquisitionUsdc: null });
    expect(checkpointExitCode(report)).toBe(0);
  });
  test("prices an acquisition only from a verified buy route", async () => {
    const report = await checkpoint({ change(quote, direction) {
      if (direction === "buy") quote.fees.protocolFee = { token: quote.toToken, amount: BigInt(1) };
    } });
    expect(report.directions[0]).toMatchObject({ executionReadiness: "unverified-actions", actionsVerified: false });
    expect(report.directions[1]).toMatchObject({ executionReadiness: "insufficient-balance", acquisitionUsdc: null });
    expect(checkpointExitCode(report)).toBe(2);
  });
  test("prices acquisition for a sell amount derived from the buy quote", async () => {
    const report = await checkpoint({ sell: BigInt(99), deriveSellFromBuy: true });
    expect(report.directions[0]).toMatchObject({ requestedAmount: "100000", quotedToAmount: "1000000" });
    expect(report.directions[1]).toMatchObject({ requestedAmount: "1000000", executionReadiness: "acquirable", acquisitionUsdc: "110000" });
    expect(checkpointExitCode(report)).toBe(0);
  });
});
