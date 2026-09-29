import { describe, expect, test } from "bun:test";
import { parsePendingActionResponse } from "@/shared/actions/contracts/get";
import { parseRecentMoneyActions } from "@/shared/actions/contracts/list";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { OPERATOR_FEE_TOKEN } from "@/shared/fees/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseTradeMetadata, parseTradeSigning, tradeRateLabel } from "./review";
import type { Address } from "./server-types";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const CBBTC = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
const session: VerifiedAccountSession = { user: { subject: "owner" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" };
const metadata = {
  product: "trade", provider: "cdp-swaps", direction: "buy", network: { name: "Base", chainId: 8453 },
  fromAsset: { id: "usdc", symbol: "USDC", decimals: 6, address: BASE_USDC_ADDRESS.toUpperCase().replace("0X", "0x") },
  toAsset: { id: "cbbtc", symbol: "cbBTC", decimals: 8, address: CBBTC.toUpperCase().replace("0X", "0x") },
  fromAmountBaseUnits: "1000000", expectedToAmountBaseUnits: "1000", minimumToAmountBaseUnits: "990",
  slippageBps: 100, fees: [{ kind: "protocol", assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100" }],
  approval: "permit2-exact", quoteBlockNumber: "100", quotedAt: "2026-09-25T12:00:00.000Z", permitDeadline: "1790338500", executionDeadline: "1790338400",
};
const signing = {
  signer: "cdp-embedded", evmAccount: OWNER.toUpperCase().replace("0X", "0x"),
  typedData: {
    domain: { name: "Coinbase Smart Wallet", version: "1", chainId: 8453, verifyingContract: OWNER },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ], CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }],
    }, primaryType: "CoinbaseSmartWalletMessage", message: { hash: `0x${"ab".repeat(32)}` },
  },
};
const id = "11111111-1111-4111-8111-111111111111";
const summary = { title: "Buy Bitcoin", amounts: [], warnings: [], expiresAt: "2026-09-25T12:02:00.000Z", metadata };

describe("trade review parsers", () => {
  test("normalizes validated trade metadata and signing addresses", () => {
    expect(parseTradeMetadata(metadata)?.fromAsset.address).toBe(BASE_USDC_ADDRESS.toLowerCase() as Address);
    const reviewed = parseTradeMetadata(metadata)!;
    expect(parseTradeSigning(signing, reviewed, OWNER)).toMatchObject({ signer: "cdp-embedded", evmAccount: OWNER });
  });
  test.each([
    { minimumToAmountBaseUnits: "1001" }, { slippageBps: 500 }, { fromAmountBaseUnits: "1.5" },
    { fromAsset: { ...metadata.fromAsset, address: OWNER } },
    { fees: [{ kind: "gas", assetId: "unknown", symbol: "?", decimals: 6, amountBaseUnits: "1" }] },
  ])("rejects tampered trade metadata %j", (tamper) => {
    expect(parseTradeMetadata({ ...metadata, ...tamper })).toBeNull();
  });
  test.each([undefined, "0", "invalid", "1790338501"])('rejects missing, invalid, or later execution deadline %s', (executionDeadline) => {
    expect(parseTradeMetadata({ ...metadata, executionDeadline })).toBeNull();
  });
  test.each(["buy", "sell"] as const)("accepts a %s fee only when its base, USDC token, and customer minimum match", (direction) => {
    const grossBuy = "1000000";
    const netBuy = "990000";
    const fee = { amountBaseUnits: direction === "buy" ? "10000" : "9", bps: 100,
      token: OPERATOR_FEE_TOKEN, recipient: OWNER, collectedBy: "in-batch-transfer" as const };
    const candidate = direction === "buy"
      ? { ...metadata, fromAmountBaseUnits: netBuy, operatorFee: fee }
      : { ...metadata, direction, fromAsset: metadata.toAsset, toAsset: metadata.fromAsset, operatorFee: fee };
    const reviewed = parseTradeMetadata(candidate);
    expect(reviewed?.operatorFee).toEqual(fee);
    expect(reviewed?.operatorFee && direction === "buy" ? (BigInt(reviewed.fromAmountBaseUnits) + BigInt(reviewed.operatorFee.amountBaseUnits)).toString() : grossBuy).toBe(grossBuy);
    for (const bad of [
      { ...fee, amountBaseUnits: direction === "buy" ? "9900" : "10" },
      { ...fee, bps: 301 },
      { ...fee, token: { ...OPERATOR_FEE_TOKEN, symbol: "ETH" } },
    ]) expect(parseTradeMetadata({ ...candidate, operatorFee: bad })).toBeNull();
    if (direction === "sell") expect(parseTradeMetadata({ ...candidate, minimumToAmountBaseUnits: "9" })).toBeNull();
  });
  test("reload keeps signing and list keeps only valid trade metadata", () => {
    const pending = parsePendingActionResponse({ id, kind: "trade", summary, signing, calls: [{ to: OWNER, data: "0x1234", value: "0" }], expiresAt: summary.expiresAt }, id, session);
    expect(pending?.metadata?.product).toBe("trade");
    expect(pending?.signing?.signer).toBe("cdp-embedded");
    expect(parsePendingActionResponse({ id, kind: "trade", summary, signing: { ...signing, evmAccount: "invalid" }, calls: [], expiresAt: summary.expiresAt }, id, session)).toBeNull();
    const item = { id, kind: "trade", owner: { subject: "owner", address: OWNER, accountProvider: "cdp-embedded" },
      summary, status: "pending", createdAt: summary.expiresAt, confirmedAt: summary.expiresAt };
    expect(parseRecentMoneyActions({ actions: [item] }, session)[0]?.action.metadata?.product).toBe("trade");
    const tampered = { ...item, summary: { ...summary, metadata: { ...metadata, minimumToAmountBaseUnits: "1001" } } };
    expect(parseRecentMoneyActions({ actions: [tampered] }, session)[0]?.action.metadata).toBeUndefined();
  });
});

describe("generic trade metadata", () => {
  test.each([6, 8, 18])("accepts a %i-decimal pair and fee bound to that pair", (decimals) => {
    const token = { id: `0x${"ab".repeat(20)}`, symbol: "ABC", decimals, address: `0x${"ab".repeat(20)}` };
    const candidate = { ...metadata, assetId: token.id, assetName: "Example", toAsset: token,
      fees: [{ kind: "protocol", assetId: token.id, symbol: "ABC", decimals, amountBaseUnits: "1" }] };
    expect(parseTradeMetadata(candidate)).toMatchObject({ assetId: token.id, assetName: "Example", toAsset: token });
    expect(parseTradeMetadata({ ...candidate, direction: "sell", fromAsset: token, toAsset: metadata.fromAsset }))
      .toMatchObject({ fromAsset: token, toAsset: { id: "usdc" } });
    expect(parseTradeMetadata({ ...candidate, fees: [{ ...candidate.fees[0], assetId: "other" }] })).toBeNull();
    expect(parseTradeMetadata({ ...candidate, toAsset: { ...token, decimals: 37 } })).toBeNull();
    expect(parseTradeMetadata({ ...candidate, toAsset: { ...token, symbol: "Unsafe Symbol" } })).toBeNull();
  });
  test("defaults legacy cbBTC metadata to the original asset identity and title", () => {
    expect(parseTradeMetadata(metadata)).toMatchObject({ assetId: "cbbtc", assetName: "Bitcoin" });
    expect(parseTradeMetadata({ ...metadata, toAsset: { ...metadata.toAsset, id: "other" } })).toBeNull();
    const item = { id, kind: "trade", owner: { subject: "owner", address: OWNER, accountProvider: "cdp-embedded" },
      summary, status: "confirmed", createdAt: summary.expiresAt, confirmedAt: summary.expiresAt };
    expect(parseRecentMoneyActions({ actions: [item] }, session)[0]?.action.metadata).toMatchObject({ assetId: "cbbtc", assetName: "Bitcoin" });
    const pending = parsePendingActionResponse({ id, kind: "trade", summary, signing, calls: [{ to: OWNER, data: "0x1234", value: "0" }], expiresAt: summary.expiresAt }, id, session);
    expect(pending?.metadata).toMatchObject({ assetId: "cbbtc", assetName: "Bitcoin" });
  });
});

describe("trade rate label", () => {
  const token = { id: "base:0x2222222222222222222222222222222222222222", symbol: "TINY", address: "0x2222222222222222222222222222222222222222" as Address };
  const rate = (decimals: number, usdcUnits: string, tokenUnits: string, direction: "buy" | "sell" = "buy") => {
    const traded = { ...token, decimals };
    const cash = { id: "usdc", symbol: "USDC", decimals: 6, address: BASE_USDC_ADDRESS.toLowerCase() as Address };
    const parsed = parseTradeMetadata(direction === "buy"
      ? { ...metadata, direction, fromAsset: cash, toAsset: traded, fromAmountBaseUnits: usdcUnits, expectedToAmountBaseUnits: tokenUnits, minimumToAmountBaseUnits: "1", assetId: token.id, assetName: "Tiny" }
      : { ...metadata, direction, fromAsset: traded, toAsset: cash, fromAmountBaseUnits: tokenUnits, expectedToAmountBaseUnits: usdcUnits, minimumToAmountBaseUnits: "1", assetId: token.id, assetName: "Tiny" });
    if (!parsed) throw new Error("fixture metadata is invalid");
    return tradeRateLabel(parsed);
  };

  test.each([
    [8, "1000000", "1000", "buy", "1 TINY ≈ $100,000.00"],
    [6, "25000000", "5000000", "sell", "1 TINY ≈ $5.00"],
    [18, "1000000", "400000000000000000000000", "buy", "1 TINY ≈ $0.0000025"],
    [18, "1000000", "4000000000000000000000000000", "buy", "1,000,000 TINY ≈ $0.00025"],
    [18, "1000000", "1000000000000000000000000000000000", "sell", "1,000,000,000 TINY ≈ $0.000001"],
  ] as const)("%i decimals, %s USDC atoms for %s token atoms (%s)", (decimals, usdcUnits, tokenUnits, direction, expected) => {
    expect(rate(decimals, usdcUnits, tokenUnits, direction)).toBe(expected);
  });
});
