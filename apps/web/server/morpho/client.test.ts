import { afterEach, describe, expect, test } from "bun:test";
import {
  clearMorphoCacheForTests,
  MORPHO_MAX_RESPONSE_BYTES,
  createMorphoVaultCandidatesReader,
  getMorphoVaultCandidates,
  MorphoUpstreamError,
} from "./client";
import {
  BASE_USDC_ADDRESS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";

afterEach(() => clearMorphoCacheForTests());

const now = () => new Date("2026-09-07T20:30:00.000Z");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function responseFetch(body: unknown, status = 200) {
  return (async () => jsonResponse(body, status)) as unknown as typeof fetch;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function candidate(address: string = MORPHO_V1_CANDIDATE_ADDRESSES[0]) {
  return {
    address,
    name: "Gauntlet USDC Prime",
    symbol: "gtUSDCp",
    listed: true,
    chain: { id: 8453, network: "Base" },
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    state: {
      timestamp: 1788811200,
      blockNumber: 35123456,
      apy: 0.04,
      netApy: 0.035,
      fee: 0,
      curator: "0x9E33faAE38ff641094fa68c65c2cE600b3410585",
      totalAssets: 1000000,
    },
    liquidity: { underlying: 750000 },
  };
}

function candidatesResponse() {
  return {
    data: {
      vaults: {
        items: [candidate()],
      },
    },
  };
}

describe("getMorphoVaultCandidates", () => {
  test("returns only configured Base USDC V1 candidates with provenance", async () => {
    const result = await getMorphoVaultCandidates({
      fetchImpl: responseFetch({
        data: {
          vaults: {
            items: [
              candidate(),
              candidate("0x1111111111111111111111111111111111111111"),
            ],
          },
        },
      }),
      now,
    });

    expect(result.version).toBe("v1");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.totalAssetsRaw).toBe("1000000");
    expect(result.source.fetchedAt).toBe("2026-09-07T20:30:00.000Z");
    expect(result.stale).toBeFalse();
  });

  test("surfaces an upstream HTTP failure instead of inventing empty data", async () => {
    await expect(
      getMorphoVaultCandidates({
        fetchImpl: responseFetch({ error: "rate limited" }, 429),
        now,
      }),
    ).rejects.toBeInstanceOf(MorphoUpstreamError);
  });

  test("surfaces GraphQL errors instead of normalizing them as zero", async () => {
    await expect(
      getMorphoVaultCandidates({
        fetchImpl: responseFetch({
          data: null,
          errors: [{ message: "schema changed" }],
        }),
        now,
      }),
    ).rejects.toBeInstanceOf(MorphoUpstreamError);
  });

  test("falls back to the cached snapshot when refresh fails within five minutes", async () => {
    let calls = 0;
    let currentTime = Date.parse("2026-09-07T20:30:00.000Z");
    const controlledNow = () => new Date(currentTime);
    const reader = createMorphoVaultCandidatesReader(
      (async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse(candidatesResponse())
          : jsonResponse({ error: "unavailable" }, 503);
      }) as unknown as typeof fetch,
    );

    const first = await reader({ now: controlledNow });
    currentTime += 30_001;
    const stale = await reader({ now: controlledNow });

    expect(calls).toBe(3);
    expect(first.stale).toBeFalse();
    expect(stale.stale).toBeTrue();
    expect(stale.source.fetchedAt).toBe("2026-09-07T20:30:00.000Z");
  });

  test("rejects a failed refresh after the cached snapshot expires", async () => {
    let calls = 0;
    let currentTime = Date.parse("2026-09-07T20:30:00.000Z");
    const controlledNow = () => new Date(currentTime);
    const reader = createMorphoVaultCandidatesReader(
      (async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse(candidatesResponse())
          : jsonResponse({ error: "unavailable" }, 503);
      }) as unknown as typeof fetch,
    );

    await reader({ now: controlledNow });
    currentTime += 5 * 60_000 + 1;

    await expect(reader({ now: controlledNow })).rejects.toBeInstanceOf(
      MorphoUpstreamError,
    );
    expect(calls).toBe(3);
  });

  test("retries one transient metadata failure and then succeeds", async () => {
    let calls = 0;
    const reader = createMorphoVaultCandidatesReader(
      (async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ error: "unavailable" }, 503)
          : jsonResponse(candidatesResponse());
      }) as unknown as typeof fetch,
    );

    const result = await reader({ now });
    expect(calls).toBe(2);
    expect(result.stale).toBeFalse();
  });

  test("clears a failed in-flight read so a manual retry can succeed", async () => {
    let calls = 0;
    const pendingFailure = deferred<Response>();
    const reader = createMorphoVaultCandidatesReader(
      (() => {
        calls += 1;
        if (calls === 1) return pendingFailure.promise;
        return Promise.resolve(calls === 2
          ? jsonResponse({ error: "still unavailable" }, 503)
          : jsonResponse(candidatesResponse()));
      }) as unknown as typeof fetch,
    );

    const first = reader({ now });
    const coalesced = reader({ now });
    const failedReads = Promise.allSettled([first, coalesced]);

    await Promise.resolve();
    expect(calls).toBe(1);
    pendingFailure.resolve(jsonResponse({ error: "unavailable" }, 503));
    const outcomes = await failedReads;
    expect(outcomes).toEqual([
      { status: "rejected", reason: expect.any(MorphoUpstreamError) },
      { status: "rejected", reason: expect.any(MorphoUpstreamError) },
    ]);

    const retried = await reader({ now });
    expect(calls).toBe(3);
    expect(retried.stale).toBeFalse();
    expect(retried.source.fetchedAt).toBe("2026-09-07T20:30:00.000Z");
  });

  test.each([
    ["oversized declared length", () => new Response("{}", { headers: { "content-length": String(MORPHO_MAX_RESPONSE_BYTES + 1) } })],
    ["oversized body", () => Response.json({ pad: "x".repeat(MORPHO_MAX_RESPONSE_BYTES) })],
    ["malformed JSON", () => new Response("{broken")],
  ] as const)("rejects %s as an upstream failure", async (_case, response) => {
    const error = await getMorphoVaultCandidates({
      fetchImpl: (async () => response()) as unknown as typeof fetch,
      now,
    }).then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(MorphoUpstreamError);
    expect((error as Error).message).toBe("Morpho GraphQL request failed.");
  });

  test("a stalled attempt spends its deadline and does not retry", async () => {
    let calls = 0;
    const error = await getMorphoVaultCandidates({
      fetchImpl: (async (_url, init) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }) as typeof fetch,
      now,
      timeoutMs: 10,
    }).then(() => null, (reason: unknown) => reason);
    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(MorphoUpstreamError);
    expect((error as Error).message).toBe("Morpho GraphQL request timed out or was aborted.");
  });

  test("does not retry when the caller aborts", async () => {
    const controller = new AbortController();
    let calls = 0;
    const error = await getMorphoVaultCandidates({
      fetchImpl: (async () => {
        calls += 1;
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }) as unknown as typeof fetch,
      signal: controller.signal,
      now,
    }).then(() => null, (reason: unknown) => reason);
    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(MorphoUpstreamError);
    expect((error as Error).message).toBe("Morpho GraphQL request timed out or was aborted.");
  });
});
