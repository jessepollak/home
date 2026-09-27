import { hashTypedData } from "viem";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { atomicToDecimal } from "@/shared/formatting/atomic";
import { formatPresentationPrice } from "@/shared/formatting";
import { formatDecimalAmount } from "@/shared/formatting/money";
import { isTradeTokenSymbol, MAX_TRADE_TOKEN_DECIMALS, TRADE_SLIPPAGE_BPS, type TradeAssetRef, type TradeMoneyActionMetadata, type TradeSigningRequest } from "./contract";
import type { Address, CoinbaseSmartWalletTypedData, Permit2TypedData } from "./server-types";

const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const address = /^0x[0-9a-fA-F]{40}$/;
const integer = /^(?:0|[1-9][0-9]*)$/;
const hash = /^0x[0-9a-fA-F]{64}$/;
const usdc: TradeAssetRef = { id: "usdc", symbol: "USDC", decimals: 6, address: BASE_USDC_ADDRESS.toLowerCase() as Address };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uint(value: unknown, positive = false): value is string {
  return typeof value === "string" && integer.test(value) && BigInt(value) <= (BigInt(1) << BigInt(256)) - BigInt(1) && (!positive || BigInt(value) > BigInt(0));
}
function parseAsset(value: unknown): TradeAssetRef | null {
  if (!record(value) || typeof value.id !== "string" || !value.id || value.id === "usdc" ||
    !isTradeTokenSymbol(value.symbol) || typeof value.decimals !== "number" || !Number.isInteger(value.decimals) ||
    value.decimals < 0 || value.decimals > MAX_TRADE_TOKEN_DECIMALS ||
    typeof value.address !== "string" || !address.test(value.address) ||
    value.address.toLowerCase() === usdc.address || /^0x0{40}$/.test(value.address)) return null;
  return { id: value.id, symbol: value.symbol, decimals: value.decimals, address: value.address.toLowerCase() as Address };
}
function usdcMatches(value: unknown): boolean {
  return record(value) && value.id === usdc.id && value.symbol === usdc.symbol && value.decimals === usdc.decimals &&
    typeof value.address === "string" && value.address.toLowerCase() === usdc.address;
}

export function tradeRateLabel(metadata: TradeMoneyActionMetadata): string {
  const traded = metadata.direction === "buy" ? metadata.toAsset : metadata.fromAsset;
  const tokenUnits = BigInt(metadata.direction === "buy" ? metadata.expectedToAmountBaseUnits : metadata.fromAmountBaseUnits);
  const usdcUnits = BigInt(metadata.direction === "buy" ? metadata.fromAmountBaseUnits : metadata.expectedToAmountBaseUnits);
  const ten = BigInt(10);
  if (tokenUnits <= BigInt(0) || usdcUnits <= BigInt(0)) return `1 ${traded.symbol} ≈ —`;
  let exponent = 0;
  while (usdcUnits * ten ** BigInt(traded.decimals + exponent + 6) < tokenUnits * ten ** BigInt(usdc.decimals)) exponent += 3;
  const precision = 30;
  const scaled = usdcUnits * ten ** BigInt(traded.decimals + exponent + precision) / tokenUnits;
  const price = formatPresentationPrice(atomicToDecimal(scaled, usdc.decimals + precision), "USD") ?? "—";
  const quantity = formatDecimalAmount(ten ** BigInt(exponent), 0, { fractionDigits: 0 });
  return `${quantity} ${traded.symbol} ≈ ${price}`;
}

export function parseTradeMetadata(value: unknown): TradeMoneyActionMetadata | null {
  if (!record(value) || value.product !== "trade" || value.provider !== "cdp-swaps" ||
    (value.direction !== "buy" && value.direction !== "sell") || !record(value.network) ||
    value.network.name !== "Base" || value.network.chainId !== 8453 ||
    !usdcMatches(value.direction === "buy" ? value.fromAsset : value.toAsset) ||
    !uint(value.fromAmountBaseUnits, true) || !uint(value.expectedToAmountBaseUnits, true) ||
    !uint(value.minimumToAmountBaseUnits, true) || BigInt(value.minimumToAmountBaseUnits) > BigInt(value.expectedToAmountBaseUnits) ||
    value.slippageBps !== TRADE_SLIPPAGE_BPS || !uint(value.quoteBlockNumber, true) || !uint(value.permitDeadline, true) ||
    !uint(value.executionDeadline, true) || BigInt(value.executionDeadline) > BigInt(value.permitDeadline) ||
    typeof value.quotedAt !== "string" || !Number.isFinite(Date.parse(value.quotedAt)) || new Date(value.quotedAt).toISOString() !== value.quotedAt ||
    !Array.isArray(value.fees) || value.fees.length > 2 ||
    (value.approval !== "permit2-exact" && value.approval !== "existing-permit2-allowance")) return null;
  const traded = parseAsset(value.direction === "buy" ? value.toAsset : value.fromAsset);
  if (!traded || (value.assetId !== undefined && value.assetId !== traded.id) ||
    (value.assetName !== undefined && (typeof value.assetName !== "string" || !value.assetName.trim() || value.assetName.length > 100)) ||
    (value.assetId === undefined && (traded.id !== "cbbtc" || traded.address !== "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" || traded.decimals !== 8 || traded.symbol !== "cbBTC")) ||
    (value.assetId !== undefined && value.assetName === undefined)) return null;
  const fees: TradeMoneyActionMetadata["fees"] = [];
  for (const fee of value.fees) {
    if (!record(fee) || (fee.kind !== "protocol" && fee.kind !== "gas") || fees.some((existing) => existing.kind === fee.kind) ||
      !uint(fee.amountBaseUnits)) return null;
    const ref = fee.assetId === usdc.id ? usdc : fee.assetId === traded.id ? traded : null;
    if (!ref || fee.symbol !== ref.symbol || fee.decimals !== ref.decimals) return null;
    fees.push({ kind: fee.kind, assetId: ref.id, symbol: ref.symbol, decimals: ref.decimals, amountBaseUnits: fee.amountBaseUnits });
  }
  return {
    product: "trade", provider: "cdp-swaps", direction: value.direction,
    network: { name: "Base", chainId: 8453 }, assetId: traded.id, assetName: value.assetName as string | undefined ?? "Bitcoin",
    fromAsset: value.direction === "buy" ? usdc : traded, toAsset: value.direction === "buy" ? traded : usdc,
    fromAmountBaseUnits: value.fromAmountBaseUnits, expectedToAmountBaseUnits: value.expectedToAmountBaseUnits,
    minimumToAmountBaseUnits: value.minimumToAmountBaseUnits, slippageBps: TRADE_SLIPPAGE_BPS,
    fees, approval: value.approval, quoteBlockNumber: value.quoteBlockNumber,
    quotedAt: value.quotedAt, permitDeadline: value.permitDeadline, executionDeadline: value.executionDeadline,
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
