import "server-only";

import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { MorphoAddress, VerifiedMorphoMarketRef } from "@/shared/morpho-markets/config";

export {
  encodeCoinbaseExecuteBatch,
  encodeImplementation,
} from "@/server/chain/coinbase-smart-account";

export type MorphoMoneyActionCall = MoneyActionCall & {
  approval?: { assetId: string; spender: MorphoAddress };
};

const SELECTOR = {
  position: "93c52062", market: "5c60e39a", idToMarketParams: "2c3c9157", price: "a035b1fe",
  borrowRateView: "8c00bf6b", balanceOf: "70a08231", allowance: "dd62ed3e", approve: "095ea7b3",
  supplyCollateral: "238d6579", borrow: "50d8cd4b", repay: "20b76e81", withdrawCollateral: "8720316d",
} as const;

export function encodePosition(marketId: `0x${string}`, account: MorphoAddress) { return data(SELECTOR.position, bytes32Word(marketId), addressWord(account)); }
export function encodeMarket(marketId: `0x${string}`) { return data(SELECTOR.market, bytes32Word(marketId)); }
export function encodeMarketParams(marketId: `0x${string}`) { return data(SELECTOR.idToMarketParams, bytes32Word(marketId)); }
export function encodePrice() { return data(SELECTOR.price); }
export function encodeBorrowRateView(ref: VerifiedMorphoMarketRef, market: readonly bigint[]) {
  if (market.length !== 6) throw new TypeError("Market state must contain six words.");
  return data(SELECTOR.borrowRateView, ...marketParamWords(ref), ...market.map(uintWord));
}
export function encodeBalanceOf(account: MorphoAddress) { return data(SELECTOR.balanceOf, addressWord(account)); }
export function encodeAllowance(owner: MorphoAddress, spender: MorphoAddress) { return data(SELECTOR.allowance, addressWord(owner), addressWord(spender)); }

export function approveCall(token: { address: MorphoAddress; id: string }, spender: MorphoAddress, amount: bigint): MorphoMoneyActionCall {
  return { to: token.address, data: data(SELECTOR.approve, addressWord(spender), uintWord(amount)), value: "0", approval: { assetId: token.id, spender } };
}
export function supplyCollateralCall(ref: VerifiedMorphoMarketRef, amount: bigint, owner: MorphoAddress): MoneyActionCall {
  return { to: ref.morpho, data: data(SELECTOR.supplyCollateral, ...marketParamWords(ref), uintWord(amount), addressWord(owner), uintWord(BigInt(8) * BigInt(32)), uintWord(BigInt(0))), value: "0" };
}
export function borrowCall(ref: VerifiedMorphoMarketRef, amount: bigint, owner: MorphoAddress): MoneyActionCall {
  return { to: ref.morpho, data: data(SELECTOR.borrow, ...marketParamWords(ref), uintWord(amount), uintWord(BigInt(0)), addressWord(owner), addressWord(owner)), value: "0" };
}
export function repayCall(ref: VerifiedMorphoMarketRef, amount: bigint, owner: MorphoAddress): MoneyActionCall { return repayAssetsOrSharesCall(ref, amount, BigInt(0), owner); }
export function repaySharesCall(ref: VerifiedMorphoMarketRef, shares: bigint, owner: MorphoAddress): MoneyActionCall { return repayAssetsOrSharesCall(ref, BigInt(0), shares, owner); }
export function withdrawCollateralCall(ref: VerifiedMorphoMarketRef, amount: bigint, owner: MorphoAddress): MoneyActionCall {
  return { to: ref.morpho, data: data(SELECTOR.withdrawCollateral, ...marketParamWords(ref), uintWord(amount), addressWord(owner), addressWord(owner)), value: "0" };
}

export function decodeWords(value: unknown, expectedWords: number, label: string): bigint[] {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{64})+$/.test(value) || (value.length - 2) / 64 !== expectedWords) throw new TypeError(`Base RPC returned invalid ${label} data.`);
  const words: bigint[] = [];
  for (let offset = 2; offset < value.length; offset += 64) words.push(BigInt(`0x${value.slice(offset, offset + 64)}`));
  return words;
}
export function decodeAddressWord(word: bigint): MorphoAddress {
  if (word < BigInt(0) || word >= (BigInt(1) << BigInt(160))) throw new TypeError("Address word is out of range.");
  return `0x${word.toString(16).padStart(40, "0")}` as MorphoAddress;
}
function repayAssetsOrSharesCall(ref: VerifiedMorphoMarketRef, assets: bigint, shares: bigint, owner: MorphoAddress): MoneyActionCall {
  if ((assets === BigInt(0)) === (shares === BigInt(0))) throw new TypeError("Morpho repayment must specify either assets or shares.");
  return { to: ref.morpho, data: data(SELECTOR.repay, ...marketParamWords(ref), uintWord(assets), uintWord(shares), addressWord(owner), uintWord(BigInt(9) * BigInt(32)), uintWord(BigInt(0))), value: "0" };
}
function marketParamWords(ref: VerifiedMorphoMarketRef) { return [addressWord(ref.loanToken.address), addressWord(ref.collateralToken.address), addressWord(ref.oracle), addressWord(ref.irm), uintWord(ref.lltvWad)]; }
function data(selector: string, ...words: string[]): `0x${string}` { return `0x${selector}${words.join("")}`; }
function addressWord(address: MorphoAddress) { if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new TypeError("Invalid address."); return address.slice(2).toLowerCase().padStart(64, "0"); }
function bytes32Word(value: `0x${string}`) { if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError("Invalid bytes32 value."); return value.slice(2).toLowerCase(); }
function uintWord(value: bigint) { if (value < BigInt(0) || value >= (BigInt(1) << BigInt(256))) throw new RangeError("uint256 is out of range."); return value.toString(16).padStart(64, "0"); }
