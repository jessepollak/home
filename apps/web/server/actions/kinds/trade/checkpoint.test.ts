import { expect, test } from "bun:test";
import { encodeAbiParameters, hashTypedData, parseAbiParameters, type HashTypedDataParameters } from "viem";
import { requireAddress } from "@/shared/chain/hex";
import type { Address, Hex } from "@/shared/trading/server-types";
import type { CdpSwapsClient, SwapQuote, SwapsRequest } from "./cdp-swaps";
import { checkpointExitCode, runSwapsCheckpoint } from "./checkpoint";
import { PERMIT2_ADDRESS } from "./permit2";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const TOKEN = requireAddress("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf");
const USDC = requireAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const TAKER = requireAddress("0x1111111111111111111111111111111111111111");
const TARGET = requireAddress("0x3333333333333333333333333333333333333333");
const POOL = requireAddress("0x5555555555555555555555555555555555555555");
const OTHER = requireAddress("0x7777777777777777777777777777777777777777");
const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, "0");
const addressWord = (address: Address) => word(BigInt(address));
type LiquidQuote = Extract<SwapQuote, { liquidityAvailable: true }>;

function fixture(input: SwapsRequest): LiquidQuote {
  const deadline = Math.floor(NOW.getTime() / 1000) + 900;
  const transfer = `0xc1fb425e${addressWord(POOL)}${addressWord(input.fromToken)}${word(input.fromAmount)}${word(4)}${word(deadline)}${word(0xc0)}`;
  const swap = `0x103b48be${encodeAbiParameters(
    parseAbiParameters("address recipient, address sellToken, uint256 ppm, address pool, uint24 swapInfo, uint256 amountOutMin"),
    [TARGET, input.fromToken, BigInt(1_000_000), POOL, 0, BigInt(0)],
  ).slice(2)}`;
  const bytes = (swap.length - 2) / 2;
  const encoded = `${word(bytes)}${swap.slice(2)}${"0".repeat((32 - bytes % 32) % 32 * 2)}`;
  const data: Hex = `0x1fff991f${addressWord(TAKER)}${addressWord(input.toToken)}${word(990)}${word(0xa0)}${word(0)}${word(2)}${word(64 + encoded.length / 2)}${word(64)}${encoded}${word(0xffff)}${transfer.slice(2)}`;
  const eip712: HashTypedDataParameters = {
    domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    },
    primaryType: "PermitTransferFrom",
    message: { permitted: { token: input.fromToken, amount: input.fromAmount.toString() }, spender: TARGET, nonce: "4", deadline: String(deadline) },
  };
  return {
    liquidityAvailable: true, fromToken: input.fromToken, toToken: input.toToken, fromAmount: input.fromAmount,
    toAmount: BigInt(1000), minToAmount: BigInt(990), blockNumber: BigInt(1000),
    fees: { gasFee: null, protocolFee: null },
    issues: { allowance: null, balance: null, simulationIncomplete: false },
    transaction: { to: TARGET, data, value: BigInt(0), gas: BigInt(100), gasPrice: BigInt(2) },
    permit2: { hash: hashTypedData(eip712), eip712 },
  };
}

function run(client: CdpSwapsClient) {
  return runSwapsCheckpoint({
    client, token: TOKEN, taker: TAKER, amounts: { buy: BigInt(1_000_000), sell: BigInt(1000) }, now: NOW,
    readBlockNumber: async () => BigInt(1000), readSwapRouter: async () => TARGET,
  });
}
function clientWithQuote(change: (quote: LiquidQuote) => SwapQuote): CdpSwapsClient {
  return {
    getPrice: async (input) => ({ ...fixture(input), gas: BigInt(100), gasPrice: BigInt(2) }),
    createQuote: async (input) => change(fixture(input)),
  };
}

test("retains exact provider token and spend echoes for both directions", async () => {
  const report = await run(clientWithQuote((quote) => quote));
  expect(report.directions.map((row) => ({
    expectedFromToken: row.expectedFromToken, expectedToToken: row.expectedToToken, requestedAmount: row.requestedAmount,
    quotedFromToken: row.quotedFromToken, quotedToToken: row.quotedToToken, quotedFromAmount: row.quotedFromAmount,
    quoteIdentityMatches: row.quoteIdentityMatches, quoteAmountMatches: row.quoteAmountMatches,
  }))).toEqual([
    { expectedFromToken: USDC, expectedToToken: TOKEN, requestedAmount: "1000000", quotedFromToken: USDC, quotedToToken: TOKEN, quotedFromAmount: "1000000", quoteIdentityMatches: true, quoteAmountMatches: true },
    { expectedFromToken: TOKEN, expectedToToken: USDC, requestedAmount: "1000", quotedFromToken: TOKEN, quotedToToken: USDC, quotedFromAmount: "1000", quoteIdentityMatches: true, quoteAmountMatches: true },
  ]);
  expect(checkpointExitCode(report)).toBe(0);
});

test.each(["fromToken", "toToken", "fromAmount"] as const)("retains mismatched %s without admitting the quote", async (field) => {
  const report = await run(clientWithQuote((quote) => ({ ...quote, [field]: field === "fromAmount" ? quote.fromAmount + BigInt(1) : OTHER })));
  for (const row of report.directions) {
    expect(row.quoteIdentityMatches).toBe(field === "fromAmount");
    expect(row.quoteAmountMatches).toBe(field !== "fromAmount");
    expect(row[field === "fromToken" ? "quotedFromToken" : field === "toToken" ? "quotedToToken" : "quotedFromAmount"]).toBe(field === "fromAmount" ? (BigInt(row.requestedAmount) + BigInt(1)).toString() : OTHER);
    expect(row.quoteCompatible).toBe(false);
    expect(row.compatibilityReason).toBe("quote-rejected");
  }
  expect(checkpointExitCode(report)).toBe(2);
});

test("keeps identity and amount evidence when calldata independently fails compatibility", async () => {
  const report = await run(clientWithQuote((quote) => ({ ...quote, transaction: { ...quote.transaction, data: "0x" } })));
  for (const row of report.directions) {
    expect(row).toMatchObject({ quoteIdentityMatches: true, quoteAmountMatches: true, calldataMatches: false, actionSelectors: null, quoteCompatible: false, compatibilityReason: "quote-rejected" });
  }
  expect(checkpointExitCode(report)).toBe(2);
});

test.each(["no-liquidity", "price-unavailable", "quote-unavailable"] as const)("records null echoes for %s, not fabricated identity evidence", async (failure) => {
  const client = clientWithQuote(() => ({ liquidityAvailable: false }));
  if (failure === "price-unavailable") client.getPrice = async () => { throw new Error("Unavailable"); };
  if (failure === "quote-unavailable") client.createQuote = async () => { throw new Error("Unavailable"); };
  const report = await run(client);
  for (const row of report.directions) {
    expect(row).toMatchObject({ quotedFromToken: null, quotedToToken: null, quotedFromAmount: null, quoteIdentityMatches: null, quoteAmountMatches: null, quotedToAmount: null, minimumToAmount: null, quoteCompatible: false, compatibilityReason: failure === "no-liquidity" ? "no-liquidity" : "provider-unavailable" });
  }
  expect(checkpointExitCode(report)).toBe(2);
});

test("unknown actions do not bypass checkpoint RFQ maker authorization", async () => {
  const client = clientWithQuote((quote) => {
    const deadline = Math.floor(NOW.getTime() / 1000) + 300;
    const rfq = `0xd92aadfb${encodeAbiParameters(
      parseAbiParameters("address recipient, ((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit, address maker, bytes makerSig, address takerToken, uint256 maxTakerAmount"),
      [TARGET, { permitted: { token: quote.toToken, amount: BigInt(500) }, nonce: BigInt(5), deadline: BigInt(deadline) }, OTHER, "0x1234", quote.fromToken, quote.fromAmount],
    ).slice(2)}`;
    const unknown = "0xaf72634f";
    const elements = [unknown, rfq].map((item) => {
      const bytes = (item.length - 2) / 2;
      return `${word(bytes)}${item.slice(2)}${"0".repeat((32 - bytes % 32) % 32 * 2)}`;
    });
    const firstElement = elements[0];
    if (!firstElement) throw new Error("Missing test action");
    const firstOffset = 96 + elements.reduce((sum, encoded) => sum + encoded.length / 2, 0);
    const transfer = `0xc1fb425e${addressWord(TARGET)}${addressWord(quote.fromToken)}${word(quote.fromAmount)}${word(4)}${word(Math.floor(NOW.getTime() / 1000) + 900)}${word(0xc0)}`;
    quote.transaction.data = `0x1fff991f${addressWord(TAKER)}${addressWord(quote.toToken)}${word(990)}${word(0xa0)}${word(0)}${word(3)}${word(firstOffset)}${word(96)}${word(96 + firstElement.length / 2)}${elements.join("")}${word(0xffff)}${transfer.slice(2)}`;
    return quote;
  });
  const report = await run(client);
  for (const row of report.directions) {
    expect(row).toMatchObject({ calldataMatches: true, inputSpend: "unmodeled", quoteCompatible: true, actionsVerified: false, executionReadiness: "provider-unavailable" });
  }
  expect(checkpointExitCode(report)).toBe(2);
});
