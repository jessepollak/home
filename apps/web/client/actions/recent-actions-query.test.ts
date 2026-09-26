import { describe, expect, test } from "bun:test";
import { TransferExecutionError } from "@/shared/transfers/types";
import {
  fetchRecentActions,
  recentActionsQueryOptions,
  recentActionsStatus,
  retryRecentActions,
} from "./recent-actions-query";

const failure = (reason: ConstructorParameters<typeof TransferExecutionError>[0], status?: number) =>
  Object.assign(new TransferExecutionError(reason), status === undefined ? {} : { status });

describe("recent actions recovery", () => {
  test("rejects malformed responses from the fetch and forwards the signal without changing valid data", async () => {
    const signal = new AbortController().signal;
    let receivedSignal: AbortSignal | undefined;
    const malformed = () => fetchRecentActions(async (inputSignal) => {
      receivedSignal = inputSignal;
      return {};
    }, signal);
    await expect(malformed()).rejects.toThrow("Recent actions response is invalid.");
    expect(receivedSignal).toBe(signal);

    const response = { actions: [null, { id: "malformed-item" }] };
    const actual = await fetchRecentActions(async (inputSignal) => {
      receivedSignal = inputSignal;
      return response;
    }, signal);
    expect(actual).toBe(response);
    expect(receivedSignal).toBe(signal);
  });

  test("retries only transient transport failures at most twice", () => {
    for (const status of [undefined, 429, 500, 503]) {
      expect(retryRecentActions(0, failure("unavailable", status))).toBe(true);
      expect(retryRecentActions(1, failure("unavailable", status))).toBe(true);
      expect(retryRecentActions(2, failure("unavailable", status))).toBe(false);
    }
    for (const status of [400, 401, 404, 410, 499]) {
      expect(retryRecentActions(0, failure("unavailable", status))).toBe(false);
    }
    for (const reason of ["stale-session", "invalid-request"] as const) {
      expect(retryRecentActions(0, failure(reason))).toBe(false);
    }
    expect(retryRecentActions(0, new DOMException("aborted", "AbortError"))).toBe(false);
    expect(retryRecentActions(0, new SyntaxError("invalid JSON"))).toBe(false);
    expect(retryRecentActions(0, new Error("invalid contract"))).toBe(false);
  });

  test("refetches on return only after a failed query", () => {
    const state = (status: "error" | "success") => ({ state: { status } });
    const onFocus = recentActionsQueryOptions.refetchOnWindowFocus;
    const onReconnect = recentActionsQueryOptions.refetchOnReconnect;
    expect(onFocus(state("success") as Parameters<typeof onFocus>[0])).toBe(false);
    expect(onReconnect(state("success") as Parameters<typeof onReconnect>[0])).toBe(false);
    expect(onFocus(state("error") as Parameters<typeof onFocus>[0])).toBe(true);
    expect(onReconnect(state("error") as Parameters<typeof onReconnect>[0])).toBe(true);
  });

  test("separates first load, healthy, recently loaded, and sustained failure states", () => {
    const base = { hasData: false, isPending: false, isError: false, dataUpdatedAt: 0, errorUpdatedAt: 0 };
    expect(recentActionsStatus({ ...base, isPending: true })).toBe("loading");
    expect(recentActionsStatus({ ...base, hasData: true, dataUpdatedAt: 1_000 })).toBe("ready");
    expect(recentActionsStatus({ ...base, isError: true, errorUpdatedAt: 1_000 })).toBe("error");
    expect(recentActionsStatus({
      ...base, hasData: true, isError: true, dataUpdatedAt: 1_000, errorUpdatedAt: 121_000,
    })).toBe("ready");
    expect(recentActionsStatus({
      ...base, hasData: true, isError: true, dataUpdatedAt: 1_000, errorUpdatedAt: 121_001,
    })).toBe("error");
  });
});
