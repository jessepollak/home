import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS } from "@/shared/money-actions/network-fee";
import { createNetworkFeeService, NetworkFeeUnavailableError } from "./fee";

const account = "0x1111111111111111111111111111111111111111" as const;
const session = { user: { subject: "fee-test" }, smartAccount: { address: account, chainId: 8453 }, accountProvider: "cdp-embedded" } as VerifiedAccountSession;
const swap = { to: "0x2222222222222222222222222222222222222222" as const, data: "0x1234" as const, value: "0" };
const permitApproval = { ...swap, approval: { assetId: "usdc", spender: swap.to } };
const draft: MoneyActionDraft = { kind: "trade", title: "Buy Bitcoin", calls: [permitApproval, swap], amounts: [], warnings: [], expiresAt: new Date(Date.now() + 600_000).toISOString() };

function service(usdc: bigint, eth = BigInt(0)) {
  let estimates = 0;
  let quotedGas: bigint | null = null;
  const fee = createNetworkFeeService({
    rpc: async (method) => {
      if (method === "eth_getCode") return "0x1234";
      if (method === "eth_call") return `0x${usdc.toString(16).padStart(64, "0")}`;
      if (method === "eth_getBalance") return `0x${eth.toString(16)}`;
      if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x3b9aca00" };
      if (method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
      throw new Error(method);
    },
    estimator: { estimateBatch: async () => { estimates++; return BigInt(100_000); } },
    client: { request: async (_method: string, params: readonly unknown[]) => {
      quotedGas = BigInt((params[0] as { callGasLimit: string }).callGasLimit);
      return { paymasterAndData: BASE_USDC_PAYMASTER_ADDRESS, tokenPayment: { address: BASE_USDC_ADDRESS, decimals: 6, maxFee: "0x186a0" } };
    } } as never,
    enabled: () => true,
  });
  return { fee, estimates: () => estimates, quotedGas: () => quotedGas };
}

describe("trade gas bounds", () => {
  test("USDC quote covers swap, Permit2 approve, and fee approve without simulation", async () => {
    const { fee, estimates, quotedGas } = service(BigInt(1_000_000));
    const result = await fee.applyNetworkFee(session, draft, { callGasLimit: BigInt(100_000) });
    expect(result.networkFee).toMatchObject({ payment: "usdc", maxFeeBaseUnits: "100000" });
    expect(result.calls[0]?.approval?.spender).toBe(BASE_USDC_PAYMASTER_ADDRESS);
    expect(quotedGas()).toBe(BigInt(270_000));
    expect(estimates()).toBe(0);
  });
  test("native fallback covers Permit2 approval but not an absent fee approval", async () => {
    const threshold = BigInt(210_000 + 450_000 + 120_000) * BigInt(3_000_000_000);
    const { fee, estimates } = service(BigInt(0), threshold);
    const result = await fee.applyNetworkFee(session, draft, { callGasLimit: BigInt(100_000) });
    expect(result.networkFee).toEqual({ payment: "native" });
    expect(result.calls).toEqual(draft.calls);
    expect(estimates()).toBe(0);
  });
  test("non-trade plans ignore the explicit bound and still simulate", async () => {
    const { fee, estimates, quotedGas } = service(BigInt(1_000_000));
    const result = await fee.applyNetworkFee(session, { ...draft, kind: "send" }, { callGasLimit: BigInt(1_000_000) });
    expect(result.networkFee).toMatchObject({ payment: "usdc" });
    expect(quotedGas()).toBe(BigInt(150_000));
    expect(estimates()).toBe(1);
  });
  test("bounds above the Coinbase batch cap never produce a fee quote", async () => {
    const { fee, estimates, quotedGas } = service(BigInt(1_000_000));
    await expect(fee.applyNetworkFee(session, draft, { callGasLimit: BigInt(3_000_000) })).rejects.toBeInstanceOf(NetworkFeeUnavailableError);
    expect(quotedGas()).toBeNull();
    expect(estimates()).toBe(0);
  });
});
