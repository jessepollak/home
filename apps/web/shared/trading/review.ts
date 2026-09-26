import { hashTypedData } from "viem";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { TRADE_SLIPPAGE_BPS, type TradeMoneyActionMetadata, type TradeSigningRequest } from "./contract";
import type { Address, CoinbaseSmartWalletTypedData, Permit2TypedData } from "./server-types";

const CBBTC = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const address = /^0x[0-9a-fA-F]{40}$/;
const integer = /^(?:0|[1-9][0-9]*)$/;
const hash = /^0x[0-9a-fA-F]{64}$/;
const assets = {
  usdc: { id: "usdc", symbol: "USDC", decimals: 6, address: BASE_USDC_ADDRESS.toLowerCase() as Address },
  cbbtc: { id: "cbbtc", symbol: "cbBTC", decimals: 8, address: CBBTC as Address },
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uint(value: unknown, positive = false): value is string {
  return typeof value === "string" && integer.test(value) && BigInt(value) <= (BigInt(1) << BigInt(256)) - BigInt(1) && (!positive || BigInt(value) > BigInt(0));
}
function asset(value: unknown, expected: typeof assets.usdc | typeof assets.cbbtc): boolean {
  return record(value) && value.id === expected.id && value.symbol === expected.symbol && value.decimals === expected.decimals &&
    typeof value.address === "string" && value.address.toLowerCase() === expected.address;
}

export function parseTradeMetadata(value: unknown): TradeMoneyActionMetadata | null {
  if (!record(value) || value.product !== "trade" || value.provider !== "cdp-swaps" ||
    (value.direction !== "buy" && value.direction !== "sell") || !record(value.network) ||
    value.network.name !== "Base" || value.network.chainId !== 8453 ||
    !asset(value.fromAsset, value.direction === "buy" ? assets.usdc : assets.cbbtc) ||
    !asset(value.toAsset, value.direction === "buy" ? assets.cbbtc : assets.usdc) ||
    !uint(value.fromAmountBaseUnits, true) || !uint(value.expectedToAmountBaseUnits, true) ||
    !uint(value.minimumToAmountBaseUnits, true) || BigInt(value.minimumToAmountBaseUnits) > BigInt(value.expectedToAmountBaseUnits) ||
    value.slippageBps !== TRADE_SLIPPAGE_BPS || !uint(value.quoteBlockNumber, true) || !uint(value.permitDeadline, true) ||
    !uint(value.executionDeadline, true) || BigInt(value.executionDeadline) > BigInt(value.permitDeadline) ||
    !Number.isFinite(Date.parse(value.quotedAt as string)) || new Date(value.quotedAt as string).toISOString() !== value.quotedAt ||
    !Array.isArray(value.fees) || value.fees.length > 2 ||
    (value.approval !== "permit2-exact" && value.approval !== "existing-permit2-allowance")) return null;
  const fees: TradeMoneyActionMetadata["fees"] = [];
  for (const fee of value.fees) {
    if (!record(fee) || (fee.kind !== "protocol" && fee.kind !== "gas") || fees.some((existing) => existing.kind === fee.kind) ||
      !uint(fee.amountBaseUnits) || (fee.assetId !== "usdc" && fee.assetId !== "cbbtc")) return null;
    const ref = assets[fee.assetId];
    if (fee.symbol !== ref.symbol || fee.decimals !== ref.decimals) return null;
    fees.push({ kind: fee.kind, assetId: ref.id, symbol: ref.symbol, decimals: ref.decimals, amountBaseUnits: fee.amountBaseUnits });
  }
  const fromAsset = value.direction === "buy" ? assets.usdc : assets.cbbtc;
  const toAsset = value.direction === "buy" ? assets.cbbtc : assets.usdc;
  return {
    product: "trade", provider: "cdp-swaps", direction: value.direction,
    network: { name: "Base", chainId: 8453 }, fromAsset, toAsset,
    fromAmountBaseUnits: value.fromAmountBaseUnits, expectedToAmountBaseUnits: value.expectedToAmountBaseUnits,
    minimumToAmountBaseUnits: value.minimumToAmountBaseUnits, slippageBps: TRADE_SLIPPAGE_BPS,
    fees, approval: value.approval, quoteBlockNumber: value.quoteBlockNumber,
    quotedAt: value.quotedAt as string, permitDeadline: value.permitDeadline, executionDeadline: value.executionDeadline,
  };
}

export function parseTradeSigning(value: unknown, metadata: TradeMoneyActionMetadata, owner: Address): TradeSigningRequest | null {
  if (!record(value) || (value.signer !== "base-account" && value.signer !== "cdp-embedded") || !record(value.typedData)) return null;
  const typed = value.typedData;
  if (!record(typed.domain) || !record(typed.types) || !record(typed.message)) return null;
  if (value.signer === "cdp-embedded") {
    if (typeof value.evmAccount !== "string" || !address.test(value.evmAccount) ||
      typed.domain.name !== "Coinbase Smart Wallet" || typed.domain.version !== "1" || typed.domain.chainId !== 8453 ||
      typeof typed.domain.verifyingContract !== "string" || typed.domain.verifyingContract.toLowerCase() !== owner.toLowerCase() ||
      typed.primaryType !== "CoinbaseSmartWalletMessage" || typeof typed.message.hash !== "string" || !hash.test(typed.message.hash) ||
      JSON.stringify(typed.types.EIP712Domain) !== JSON.stringify([
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ]) || JSON.stringify(typed.types.CoinbaseSmartWalletMessage) !== JSON.stringify([{ name: "hash", type: "bytes32" }])) return null;
    return {
      signer: "cdp-embedded", evmAccount: value.evmAccount.toLowerCase() as Address,
      typedData: {
        domain: { name: "Coinbase Smart Wallet", version: "1", chainId: 8453, verifyingContract: owner.toLowerCase() as Address },
        types: typed.types as CoinbaseSmartWalletTypedData["types"], primaryType: "CoinbaseSmartWalletMessage",
        message: { hash: typed.message.hash.toLowerCase() as `0x${string}` },
      },
    };
  }
  if (value.evmAccount !== undefined || typed.domain.name !== "Permit2" || typed.domain.chainId !== 8453 ||
    typeof typed.domain.verifyingContract !== "string" || typed.domain.verifyingContract.toLowerCase() !== PERMIT2 ||
    typed.primaryType !== "PermitTransferFrom" || !record(typed.message.permitted) ||
    (typeof typed.message.permitted.token === "string" ? typed.message.permitted.token.toLowerCase() : null) !== metadata.fromAsset.address ||
    typed.message.permitted.amount !== metadata.fromAmountBaseUnits ||
    typed.message.deadline !== metadata.permitDeadline || !uint(typed.message.nonce) ||
    typeof typed.message.spender !== "string" || !address.test(typed.message.spender) ||
    JSON.stringify(typed.types.PermitTransferFrom) !== JSON.stringify([
      { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ]) || JSON.stringify(typed.types.TokenPermissions) !== JSON.stringify([
      { name: "token", type: "address" }, { name: "amount", type: "uint256" },
    ])) return null;
  try {
    hashTypedData(typed as Parameters<typeof hashTypedData>[0]);
    return {
      signer: "base-account",
      typedData: {
        domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2 },
        types: typed.types as Permit2TypedData["types"], primaryType: "PermitTransferFrom",
        message: {
          permitted: { token: metadata.fromAsset.address, amount: metadata.fromAmountBaseUnits },
          spender: typed.message.spender.toLowerCase() as Address,
          nonce: typed.message.nonce, deadline: metadata.permitDeadline,
        },
      },
    };
  } catch { return null; }
}
