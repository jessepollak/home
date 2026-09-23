import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { encodeFunctionData, erc20Abi } from "viem";
import { checkPreparedAction, decodeSendRecipient, preparedFromHar } from "./action";
import { BASE_USDC } from "../shared/assets/base";

const id = "11111111-1111-4111-8111-111111111111";
const owner = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const token = BASE_USDC.address;
const amount = (direction: "spend" | "receive", maximum = false) => ({ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100000", direction, ...(maximum ? { maximum: true } : {}) });
const prepared = (kind: string, amounts: unknown[] = [amount("spend")]) => ({
  id, kind, owner: { subject: "fixture", address: owner, chainId: 8453, accountProvider: "cdp-embedded" },
  amounts, calls: [{ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, BigInt(100000)] }), value: "0" }],
  expiresAt: "2099-01-01T00:00:00.000Z",
});
const check = (action: unknown, surface = "send", operation: string | null = null, target: string | null = recipient, handle: string | null = null) =>
  checkPreparedAction(action, id, surface, operation, target, handle, owner, Date.parse("2026-09-23T00:00:00Z"));

describe("prepared action authority", () => {
  test("decodes ERC-20 transfer and native recipient from calls", () => {
    expect(check(prepared("send"))).toEqual({ amountUsd: 0.1, recipient });
    const native = { ...prepared("send"), calls: [{ to: recipient, data: "0x", value: "100000" }] };
    expect(decodeSendRecipient(native.calls[0] as { to: `0x${string}`; data: `0x${string}`; value: string }, BigInt(100000))).toBe(recipient);
    expect(() => check(native)).toThrow("not a Base USDC transfer");
    expect(() => decodeSendRecipient({ ...native.calls[0], value: "100001" } as { to: `0x${string}`; data: `0x${string}`; value: string }, BigInt(100000))).toThrow("value");
  });

  test("refuses mismatched owner, expiration, kind, amount and ambiguous rows", () => {
    expect(() => check({ ...prepared("send"), owner: { address: recipient } })).toThrow("surface");
    expect(() => check({ ...prepared("send"), expiresAt: "2020-01-01T00:00:00Z" })).toThrow("expired");
    expect(() => check(prepared("repay"))).toThrow("surface");
    expect(() => check(prepared("send", [amount("spend"), amount("spend")]))).toThrow("exactly one");
    expect(() => check(prepared("send", [{ ...amount("spend"), symbol: "ETH", decimals: 18 }]))).toThrow("USDC");
    expect(() => check(prepared("send", [{ ...amount("spend"), assetId: "fake-usdc" }]))).toThrow("pinned Base USDC");
  });

  test("caps the server's relevant USD row for each canary action shape", () => {
    const cases = [
      ["savings-deposit", "save", "deposit", [amount("spend"), { ...amount("receive"), symbol: "vault shares", decimals: 18 }]],
      ["savings-withdraw", "save", "withdraw", [amount("receive"), { ...amount("spend"), symbol: "vault shares", decimals: 18 }]],
      ["borrow", "borrow", "borrow", [amount("receive"), { ...amount("spend"), assetId: "collateral", symbol: "WETH", decimals: 18 }]],
      ["repay", "borrow", "repay", [amount("spend", true), { ...amount("spend"), estimated: true }]],
      ["cash-out", "cash-out", "cash-out", [amount("spend")]],
      ["cash-out-withdraw", "cash-out", "withdraw", [amount("receive")]],
    ] as const;
    for (const [kind, surface, operation, amounts] of cases) {
      const metadata = kind === "borrow" ? { product: "borrow", operation: "supply-and-borrow", collateralAsset: { id: "collateral" } }
        : kind === "repay" ? { product: "borrow", operation: "repay-all" }
        : kind.startsWith("cash-out") ? { product: "cashout", operation: kind === "cash-out" ? "deposit" : "withdraw", canonicalHandle: "zzpayout" }
        : undefined;
      expect(check({ ...prepared(kind, [...amounts]), metadata }, surface, operation, null, "zzpayout").amountUsd).toBe(0.1);
    }
  });

  test("selects only one matching 201 prepare response body and refuses missing, duplicated, or unreadable bodies", () => {
    const entry = (value: unknown, status = 201) => ({ request: { method: "POST", url: "https://example.com/api/actions/prepare", headers: [{ name: "Authorization", value: "secret-never-logged" }] }, response: { status, content: { text: JSON.stringify(value) } } });
    expect(preparedFromHar({ log: { entries: [entry(prepared("send"))] } }, "https://example.com", id)).toEqual(prepared("send"));
    expect(() => preparedFromHar({ log: { entries: [entry(prepared("send"), 401)] } }, "https://example.com", id)).toThrow("found 0");
    expect(() => preparedFromHar({ log: { entries: [entry(prepared("send")), entry(prepared("send"))] } }, "https://example.com", id)).toThrow("found 2");
    expect(() => preparedFromHar({ log: { entries: [{ ...entry(prepared("send")), response: { status: 201, content: {} } }] } }, "https://example.com", id)).toThrow("unavailable");
  });
});

describe("rendered money control names", () => {
  test("uses a real MoneyTicker's visible name for confirm, plain-click fencing, and ref clicks", () => {
    const result = Bun.spawnSync(["bun", "apps/web/verify/test-fixtures/confirm-control.ts"], {
      cwd: resolve(import.meta.dir, "../../.."), stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      confirm: [{ id, name: "Send $0.10" }],
      protected: true,
      incorrectName: false,
      ref: "Send $0.10",
      labelledConfirm: [{ id, name: "Send USDC" }],
      labelledProtected: true,
      labelledRef: "Send USDC",
    });
  });
});
