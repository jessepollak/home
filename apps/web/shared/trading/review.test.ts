import { describe, expect, test } from "bun:test";
import { parsePendingActionResponse } from "@/shared/actions/contracts/get";
import { parseRecentMoneyActions } from "@/shared/actions/contracts/list";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseTradeMetadata, parseTradeSigning } from "./review";
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
