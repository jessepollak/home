import { describe, expect, test } from "bun:test";
import type { OperatorSettingsStore } from "@/server/operator-settings/store";
import { feePolicyForTaker, resolveOperatorFeePolicy } from "./policy";

const recipient = "0x1234567890123456789012345678901234567890" as const;
const store = (value: unknown): Pick<OperatorSettingsStore, "read"> => ({
  read: async (domain) => {
    expect(domain).toBe("fees");
    return { domain, settings: { value, source: "stored", revision: 1, updatedAt: null, updatedBy: null } };
  },
});

describe("trade fee policy", () => {
  test("reads the fees settings domain and disables zero or recipient-free fees", async () => {
    expect(await resolveOperatorFeePolicy("trade", store({ trade: { bps: 250, recipient } }))).toEqual({ bps: 250, recipient });
    expect(await resolveOperatorFeePolicy("trade", store({ trade: { bps: 0, recipient } }))).toEqual({ bps: 0, recipient: null });
    expect(await resolveOperatorFeePolicy("trade", store({ trade: { bps: 0, recipient: null } }))).toEqual({ bps: 0, recipient: null });
  });
  test("fails closed on an unreadable or malformed settings value", async () => {
    await expect(resolveOperatorFeePolicy("trade", { read: async () => { throw new Error("database unavailable"); } }))
      .rejects.toMatchObject({ reason: "provider-unavailable" });
    await expect(resolveOperatorFeePolicy("trade", store({ trade: { bps: 301, recipient } })))
      .rejects.toMatchObject({ reason: "provider-unavailable" });
  });
  test("disables the fee when the recipient is the taker", () => {
    expect(feePolicyForTaker({ bps: 250, recipient: "0xABCDEF0000000000000000000000000000000001" }, "0xabcdef0000000000000000000000000000000001")).toEqual({ bps: 0, recipient: null });
    expect(feePolicyForTaker({ bps: 250, recipient }, "0x9999999999999999999999999999999999999999")).toEqual({ bps: 250, recipient });
    expect(feePolicyForTaker({ bps: 250, recipient: null }, recipient)).toEqual({ bps: 250, recipient: null });
  });
});
