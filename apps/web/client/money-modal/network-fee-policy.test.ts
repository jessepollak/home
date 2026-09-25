import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { getHomeQueryClient } from "@/client/query/query-client";

const { act, cleanup, renderHook, waitFor } = await import("@testing-library/react");
const { maxAmountAfterNetworkFee, useNetworkFeeReserve } = await import("./network-fee-policy");

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

test.each(["request", "malformed"] as const)("%s failures keep USDC Max unavailable", async (failure) => {
  let requests = 0;
  const { result } = renderHook(() => useNetworkFeeReserve(`fee-${failure}`, async () => {
    requests++;
    if (failure === "request") throw new Error("network unavailable");
    return { version: 1, usdcReserveBaseUnits: "bad" };
  }, true));
  expect(result.current.reserve).toBeUndefined();
  expect(result.current.failed).toBe(false);
  await waitFor(() => expect(requests).toBe(3));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.reserve).toBeUndefined();
});

test("a manual retry clears the failure and yields the new reserve", async () => {
  let requests = 0;
  const { result } = renderHook(() => useNetworkFeeReserve("fee-retry", async () => {
    requests++;
    if (requests <= 3) throw new Error("network unavailable");
    return { version: 1, usdcReserveBaseUnits: "20000" };
  }, true));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.reserve).toBeUndefined();
  await act(async () => { result.current.retry(); });
  await waitFor(() => expect(result.current.reserve).toBe("20000"));
  expect(result.current.failed).toBe(false);
  expect(requests).toBe(4);
});

test("a cached null is unavailable during a reopen refetch and yields the new reserve", async () => {
  let requests = 0;
  let resolveRefresh: ((value: { version: 1; usdcReserveBaseUnits: string }) => void) | undefined;
  const fetchAccountResource = async () => {
    requests++;
    if (requests === 1) return { version: 1, usdcReserveBaseUnits: null };
    return new Promise<{ version: 1; usdcReserveBaseUnits: string }>((resolve) => { resolveRefresh = resolve; });
  };
  const { result, rerender } = renderHook(({ open }) => useNetworkFeeReserve("fee-reopen", fetchAccountResource, open), {
    initialProps: { open: true },
  });
  await waitFor(() => expect(result.current.reserve).toBeNull());
  rerender({ open: false });
  expect(requests).toBe(1);
  rerender({ open: true });
  await waitFor(() => expect(requests).toBe(2));
  expect(result.current.reserve).toBeUndefined();
  expect(result.current.failed).toBe(false);
  resolveRefresh?.({ version: 1, usdcReserveBaseUnits: "100000" });
  await waitFor(() => expect(result.current.reserve).toBe("100000"));
});

test("a closed hook does not fetch", () => {
  let requests = 0;
  renderHook(() => useNetworkFeeReserve("fee-closed", async () => {
    requests++;
    return { version: 1, usdcReserveBaseUnits: null };
  }, false));
  expect(requests).toBe(0);
});

test("successful policy with no owner returns null without fetching", () => {
  let requests = 0;
  const { result } = renderHook(() => useNetworkFeeReserve(null, async () => {
    requests++;
    return { version: 1, usdcReserveBaseUnits: null };
  }, true));
  expect(result.current.reserve).toBeNull();
  expect(result.current.failed).toBe(false);
  expect(requests).toBe(0);
});

describe("USDC Max reserve", () => {
  test("subtracts the reserve only for USDC and floors at zero", () => {
    expect(maxAmountAfterNetworkFee("1000000", "USDC", "20000")).toBe("980000");
    expect(maxAmountAfterNetworkFee("10000", "USDC", "20000")).toBe("0");
    expect(maxAmountAfterNetworkFee("1000000", "ETH", "20000")).toBe("1000000");
    expect(maxAmountAfterNetworkFee("1000000", "USDC", null)).toBe("1000000");
    expect(maxAmountAfterNetworkFee("1000000", "USDC", undefined)).toBe("0");
    expect(maxAmountAfterNetworkFee("1000000", "ETH", undefined)).toBe("1000000");
    expect(maxAmountAfterNetworkFee(null, "USDC", "20000")).toBeNull();
  });
});
