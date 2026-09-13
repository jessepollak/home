import { afterEach, describe, expect, test } from "bun:test";
import {
  clearMorphoCacheForTests,
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
