import "server-only";

import { describe, expect, test } from "bun:test";
import { resolveTransferRecipientName } from "./recipient-resolver";

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("recipient name resolution deadline", () => {
  test("resolves to no recipient when the lookup outlives its timeout, with or without a caller signal", async () => {
    const parent = new AbortController();
    const seen: AbortSignal[] = [];
    const resolveBasename = (_name: string, { signal }: { signal: AbortSignal }) => {
      seen.push(signal);
      return untilAborted(signal);
    };
    expect(await resolveTransferRecipientName("slow.base.eth", { timeoutMs: 1, resolveBasename })).toBeNull();
    expect(await resolveTransferRecipientName("slow.base.eth", { timeoutMs: 1, signal: parent.signal, resolveBasename })).toBeNull();
    expect(seen).toHaveLength(2);
    expect(seen.every((signal) => signal.aborted)).toBe(true);
    expect(parent.signal.aborted).toBe(false);
  });

  test("resolves to no recipient when the caller aborts mid-lookup", async () => {
    const parent = new AbortController();
    const reason = new Error("caller aborted the lookup");
    const composed: AbortSignal[] = [];
    const resolveEnsName = (_name: string, { signal }: { signal: AbortSignal }) => {
      composed.push(signal);
      queueMicrotask(() => parent.abort(reason));
      return untilAborted(signal);
    };
    expect(await resolveTransferRecipientName("gone.eth", { signal: parent.signal, resolveEnsName })).toBeNull();
    expect(composed[0]?.reason).toBe(reason);
  });

  test("returns the address when the lookup beats the deadline", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    expect(await resolveTransferRecipientName("fast.base.eth", { resolveBasename: async () => address })).toBe(address);
  });
});
