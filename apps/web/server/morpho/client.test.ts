import { afterEach, describe, expect, test } from "bun:test";
import {
  clearMorphoCacheForTests,
  createMorphoVaultCandidatesReader,
  getMorphoVaultCandidates,
  getMorphoVaultPosition,
  MorphoUpstreamError,
} from "./client";
import {
  BASE_USDC_ADDRESS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "./config";
import type { Address } from "./types";

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

  test("serves a fresh cached result without another transport call", async () => {
    let calls = 0;
    let currentTime = Date.parse("2026-09-07T20:30:00.000Z");
    const controlledNow = () => new Date(currentTime);
    const reader = createMorphoVaultCandidatesReader(
      (async () => {
        calls += 1;
        return jsonResponse(candidatesResponse());
      }) as unknown as typeof fetch,
    );

    const first = await reader({ now: controlledNow });
    currentTime += 29_999;
    const cached = await reader({ now: controlledNow });

    expect(calls).toBe(1);
    expect(first.stale).toBeFalse();
    expect(cached.stale).toBeFalse();
    expect(cached.source.fetchedAt).toBe("2026-09-07T20:30:00.000Z");
  });

  test("coalesces concurrent production-path reads", async () => {
    let calls = 0;
    const pendingResponse = deferred<Response>();
    const reader = createMorphoVaultCandidatesReader(
      (() => {
        calls += 1;
        return pendingResponse.promise;
      }) as unknown as typeof fetch,
    );

    const first = reader({ now });
    const second = reader({ now });

    expect(calls).toBe(1);
    pendingResponse.resolve(jsonResponse(candidatesResponse()));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(firstResult.stale).toBeFalse();
    expect(firstResult.source.fetchedAt).toBe("2026-09-07T20:30:00.000Z");
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

    expect(calls).toBe(2);
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
    expect(calls).toBe(2);
  });

  test("clears a failed in-flight read so a manual retry can succeed", async () => {
    let calls = 0;
    const pendingFailure = deferred<Response>();
    const reader = createMorphoVaultCandidatesReader(
      (() => {
        calls += 1;
        return calls === 1
          ? pendingFailure.promise
          : Promise.resolve(jsonResponse(candidatesResponse()));
      }) as unknown as typeof fetch,
    );

    const first = reader({ now });
    const coalesced = reader({ now });
    const failedReads = Promise.allSettled([first, coalesced]);

    expect(calls).toBe(1);
    pendingFailure.resolve(jsonResponse({ error: "unavailable" }, 503));
    const outcomes = await failedReads;
    expect(outcomes).toEqual([
      { status: "rejected", reason: expect.any(MorphoUpstreamError) },
      { status: "rejected", reason: expect.any(MorphoUpstreamError) },
    ]);

    const retried = await reader({ now });
    expect(calls).toBe(2);
    expect(retried.stale).toBeFalse();
    expect(retried.source.fetchedAt).toBe("2026-09-07T20:30:00.000Z");
  });
});

describe("getMorphoVaultPosition", () => {
  const account = {
    address: "0x2222222222222222222222222222222222222222" as Address,
    verification: "caller-verified-session-smart-account" as const,
  };

  test("requires a configured vault", async () => {
    await expect(
      getMorphoVaultPosition({
        account,
        vaultAddress: "0x1111111111111111111111111111111111111111",
        fetchImpl: responseFetch({ data: { vaultPosition: null } }),
      }),
    ).rejects.toThrow("configured vaults");
  });

  test("keeps indexed assets separate from current withdrawable amount", async () => {
    const vaultAddress = MORPHO_V1_CANDIDATE_ADDRESSES[0];
    const result = await getMorphoVaultPosition({
      account,
      vaultAddress,
      fetchImpl: responseFetch({
        data: {
          vaultPosition: {
            vault: {
              address: vaultAddress,
              chain: { id: 8453 },
              asset: { address: BASE_USDC_ADDRESS, decimals: 6 },
            },
            state: {
              timestamp: 1788811200,
              assets: 123456789,
              shares: 120000000,
            },
          },
        },
      }),
      now,
    });

    expect(result?.assetsRaw).toBe("123456789");
    expect(result?.sharesRaw).toBe("120000000");
    expect(result?.withdrawableRaw).toBeNull();
    expect(result?.withdrawableNote).toContain("maxWithdraw");
  });

  test("returns null when the index has no position instead of zero", async () => {
    const result = await getMorphoVaultPosition({
      account,
      vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0],
      fetchImpl: responseFetch({ data: { vaultPosition: null } }),
      now,
    });

    expect(result).toBeNull();
  });

  test("treats Morpho NOT_FOUND as no indexed position instead of failing the Save read", async () => {
    const result = await getMorphoVaultPosition({
      account,
      vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0],
      fetchImpl: responseFetch({
        data: null,
        errors: [{
          message: "No results matching given parameters",
          status: "NOT_FOUND",
          extensions: {},
        }],
      }),
      now,
    });

    expect(result).toBeNull();
  });

  test("still fails closed on a non-NOT_FOUND GraphQL error", async () => {
    await expect(
      getMorphoVaultPosition({
        account,
        vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0],
        fetchImpl: responseFetch({
          data: null,
          errors: [{ message: "schema changed", status: "BAD_REQUEST" }],
        }),
        now,
      }),
    ).rejects.toBeInstanceOf(MorphoUpstreamError);
  });

  test("does not treat a mixed NOT_FOUND envelope as an empty position", async () => {
    await expect(
      getMorphoVaultPosition({
        account,
        vaultAddress: MORPHO_V1_CANDIDATE_ADDRESSES[0],
        fetchImpl: responseFetch({
          data: null,
          errors: [
            { message: "No results matching given parameters", status: "NOT_FOUND" },
            { message: "rate limited", status: "TOO_MANY_REQUESTS" },
          ],
        }),
        now,
      }),
    ).rejects.toBeInstanceOf(MorphoUpstreamError);
  });
});
