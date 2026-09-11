import type { MoneyActionCall } from "@/shared/money-actions/types";
import {
  BORROW_MARKET_PARAMS,
  type BorrowAddress,
} from "@/shared/borrowing/config";

export type BorrowMoneyActionCall = MoneyActionCall & {
  approval?: {
    assetId: string;
    spender: BorrowAddress;
  };
};

const SELECTOR = {
  position: "93c52062",
  market: "5c60e39a",
  idToMarketParams: "2c3c9157",
  price: "a035b1fe",
  borrowRateView: "8c00bf6b",
  balanceOf: "70a08231",
  allowance: "dd62ed3e",
  approve: "095ea7b3",
  supplyCollateral: "238d6579",
  borrow: "50d8cd4b",
  repay: "20b76e81",
  withdrawCollateral: "8720316d",
  executeBatch: "34fcd5be",
  implementation: "5c60da1b",
} as const;

export function encodePosition(marketId: `0x${string}`, account: BorrowAddress) {
  return data(SELECTOR.position, bytes32Word(marketId), addressWord(account));
}

export function encodeMarket(marketId: `0x${string}`) {
  return data(SELECTOR.market, bytes32Word(marketId));
}

export function encodeMarketParams(marketId: `0x${string}`) {
  return data(SELECTOR.idToMarketParams, bytes32Word(marketId));
}

export function encodePrice() {
  return data(SELECTOR.price);
}

export function encodeBorrowRateView(market: readonly bigint[]) {
  if (market.length !== 6) throw new TypeError("Market state must contain six words.");
  return data(
    SELECTOR.borrowRateView,
    ...marketParamWords(),
    ...market.map(uintWord),
  );
}

export function encodeBalanceOf(account: BorrowAddress) {
  return data(SELECTOR.balanceOf, addressWord(account));
}

export function encodeAllowance(owner: BorrowAddress, spender: BorrowAddress) {
  return data(SELECTOR.allowance, addressWord(owner), addressWord(spender));
}

export function approveCall(
  token: { address: BorrowAddress; id: string },
  spender: BorrowAddress,
  amount: bigint,
): BorrowMoneyActionCall {
  return {
    to: token.address,
    data: data(SELECTOR.approve, addressWord(spender), uintWord(amount)),
    value: "0",
    approval: { assetId: token.id, spender },
  };
}

export function supplyCollateralCall(
  morpho: BorrowAddress,
  amount: bigint,
  owner: BorrowAddress,
): MoneyActionCall {
  return {
    to: morpho,
    data: data(
      SELECTOR.supplyCollateral,
      ...marketParamWords(),
      uintWord(amount),
      addressWord(owner),
      uintWord(BigInt("8") * BigInt("32")),
      uintWord(BigInt("0")),
    ),
    value: "0",
  };
}

export function borrowCall(
  morpho: BorrowAddress,
  amount: bigint,
  owner: BorrowAddress,
): MoneyActionCall {
  return {
    to: morpho,
    data: data(
      SELECTOR.borrow,
      ...marketParamWords(),
      uintWord(amount),
      uintWord(BigInt("0")),
      addressWord(owner),
      addressWord(owner),
    ),
    value: "0",
  };
}

export function repayCall(
  morpho: BorrowAddress,
  amount: bigint,
  owner: BorrowAddress,
): MoneyActionCall {
  return repayAssetsOrSharesCall(morpho, amount, BigInt("0"), owner);
}

export function repaySharesCall(
  morpho: BorrowAddress,
  shares: bigint,
  owner: BorrowAddress,
): MoneyActionCall {
  return repayAssetsOrSharesCall(morpho, BigInt("0"), shares, owner);
}

export function withdrawCollateralCall(
  morpho: BorrowAddress,
  amount: bigint,
  owner: BorrowAddress,
): MoneyActionCall {
  return {
    to: morpho,
    data: data(
      SELECTOR.withdrawCollateral,
      ...marketParamWords(),
      uintWord(amount),
      addressWord(owner),
      addressWord(owner),
    ),
    value: "0",
  };
}

export function encodeCoinbaseExecuteBatch(calls: readonly MoneyActionCall[]): `0x${string}` {
  if (calls.length === 0) throw new TypeError("Coinbase executeBatch requires at least one call.");
  const tupleBodies = calls.map((call) => {
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(call.data)) throw new TypeError("Invalid call data.");
    const callData = call.data.slice(2).toLowerCase();
    const paddedData = callData.padEnd(Math.ceil(callData.length / 64) * 64, "0");
    return [
      addressWord(call.to as BorrowAddress),
      uintWord(BigInt(call.value)),
      uintWord(BigInt("96")),
      uintWord(BigInt(callData.length / 2)),
      paddedData,
    ].join("");
  });
  let offset = BigInt(calls.length * 32);
  const offsets = tupleBodies.map((body) => {
    const word = uintWord(offset);
    offset += BigInt(body.length / 2);
    return word;
  });
  return data(
    SELECTOR.executeBatch,
    uintWord(BigInt("32")),
    uintWord(BigInt(calls.length)),
    ...offsets,
    ...tupleBodies,
  );
}

export function encodeImplementation() {
  return data(SELECTOR.implementation);
}

export function decodeWords(value: unknown, expectedWords: number, label: string): bigint[] {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{64})+$/.test(value) ||
    (value.length - 2) / 64 !== expectedWords
  ) {
    throw new TypeError(`Base RPC returned invalid ${label} data.`);
  }
  const words: bigint[] = [];
  for (let offset = 2; offset < value.length; offset += 64) {
    words.push(BigInt(`0x${value.slice(offset, offset + 64)}`));
  }
  return words;
}

export function decodeAddressWord(word: bigint): BorrowAddress {
  if (word < BigInt("0") || word >= (BigInt("1") << BigInt("160"))) throw new TypeError("Address word is out of range.");
  return `0x${word.toString(16).padStart(40, "0")}` as BorrowAddress;
}

function repayAssetsOrSharesCall(
  morpho: BorrowAddress,
  assets: bigint,
  shares: bigint,
  owner: BorrowAddress,
): MoneyActionCall {
  if ((assets === BigInt("0")) === (shares === BigInt("0"))) {
    throw new TypeError("Morpho repayment must specify either assets or shares.");
  }
  return {
    to: morpho,
    data: data(
      SELECTOR.repay,
      ...marketParamWords(),
      uintWord(assets),
      uintWord(shares),
      addressWord(owner),
      uintWord(BigInt("9") * BigInt("32")),
      uintWord(BigInt("0")),
    ),
    value: "0",
  };
}

function marketParamWords() {
  return [
    addressWord(BORROW_MARKET_PARAMS.loanToken),
    addressWord(BORROW_MARKET_PARAMS.collateralToken),
    addressWord(BORROW_MARKET_PARAMS.oracle),
    addressWord(BORROW_MARKET_PARAMS.irm),
    uintWord(BORROW_MARKET_PARAMS.lltv),
  ];
}

function data(selector: string, ...words: string[]): `0x${string}` {
  return `0x${selector}${words.join("")}`;
}

function addressWord(address: BorrowAddress) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new TypeError("Invalid address.");
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function bytes32Word(value: `0x${string}`) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError("Invalid bytes32 value.");
  return value.slice(2).toLowerCase();
}

function uintWord(value: bigint) {
  if (value < BigInt("0") || value >= (BigInt("1") << BigInt("256"))) throw new RangeError("uint256 is out of range.");
  return value.toString(16).padStart(64, "0");
}
