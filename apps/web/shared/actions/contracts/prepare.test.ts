import { describe, expect, test } from "bun:test";
import { validPrepared } from "./prepare";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

const address = "0x1111111111111111111111111111111111111111" as const;
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const paymaster = "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c" as const;
const session: VerifiedAccountSession = { user: { subject: "subject" }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" };
const fee = { payment: "usdc", token, paymaster, maxFeeBaseUnits: "20000", decimals: 6 };
const approval = { to: token, value: "0", data: `0x095ea7b3${paymaster.slice(2).padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}` };
const prepared = { id: "action", owner: { subject: "subject", address, accountProvider: "cdp-embedded" }, calls: [approval], amounts: [], warnings: [], networkFee: fee };

describe("prepared network fee validation", () => {
  test("accepts native and absent fee and a matching USDC approval", () => {
    expect(validPrepared(prepared, session)).toBe(true);
    expect(validPrepared({ ...prepared, networkFee: { payment: "native" }, calls: [] }, session)).toBe(true);
    expect(validPrepared({ ...prepared, networkFee: undefined, calls: [] }, session)).toBe(true);
  });

  test("rejects invalid fee payload and a missing or mismatched leading approval", () => {
    expect(validPrepared({ ...prepared, networkFee: { ...fee, maxFeeBaseUnits: "0" } }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [] }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [{ ...approval, to: paymaster }] }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [{ ...approval, data: `0x095ea7b3${paymaster.slice(2).padStart(64, "0")}${BigInt(20_001).toString(16).padStart(64, "0")}` }] }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [{ ...approval, data: approval.data.replace("095ea7b3", "a9059cbb") }] }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [{ ...approval, data: `0x095ea7b3${address.slice(2).padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}` }] }, session)).toBe(false);
  });
});
