import { describe, expect, test } from "bun:test";
import { type MoneyActionNetworkFee, type MoneyActionOwner, type PreparedMoneyAction } from "@/shared/money-actions/types";
import { moneyConfirmFacts, type MoneyConfirmFacts } from "./confirm-facts";

type Base = Pick<MoneyConfirmFacts, "owner" | "network" | "fee">;
type Accepts<Candidate> = Candidate extends MoneyConfirmFacts ? true : false;
type Slippage = { maxBps: number };

/** Compile-time contract: the tuples only typecheck while valid facts are accepted and each missing or misplaced fact is rejected. */
const acceptedFacts: [Accepts<Base & { kind: "send" }>, Accepts<Base & { kind: "trade"; slippage: Slippage }>] = [true, true];
const rejectedFacts: [
  Accepts<Omit<Base, "fee"> & { kind: "send" }>,
  Accepts<Omit<Base, "network"> & { kind: "send" }>,
  Accepts<Omit<Base, "owner"> & { kind: "send" }>,
  Accepts<Base & { kind: "trade" }>,
  Accepts<Base & { kind: "send"; slippage: Slippage }>,
] = [false, false, false, false, false];

const owner: MoneyActionOwner = { subject: "owner", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" };
const usdcFee: MoneyActionNetworkFee = { payment: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "20000", decimals: 6 };
const action = (overrides: Partial<PreparedMoneyAction>): PreparedMoneyAction => ({
  id: "a", kind: "send", title: "Send", calls: [], amounts: [], warnings: [], owner,
  createdAt: "2026-09-23T00:00:00.000Z", expiresAt: "2099-09-23T00:00:00.000Z", ...overrides,
});

describe("moneyConfirmFacts", () => {
  test("requires fee, network, owner and trade slippage at compile time", () => {
    expect(acceptedFacts.every(Boolean)).toBe(true);
    expect(rejectedFacts.some(Boolean)).toBe(false);
  });

  test("carries the quoted USDC fee and treats a missing fee as paid natively", () => {
    expect(moneyConfirmFacts(action({ networkFee: usdcFee }))?.fee).toEqual(usdcFee);
    expect(moneyConfirmFacts(action({ networkFee: { payment: "native" } }))?.fee).toEqual({ payment: "native" });
    expect(moneyConfirmFacts(action({}))?.fee).toEqual({ payment: "native" });
  });

  test("has no facts for a trade without trade metadata rather than an unknown slippage", () => {
    expect(moneyConfirmFacts(action({ kind: "trade" }))).toBeNull();
  });
});
