import { expect, test } from "bun:test";
import { getMorphoVaultCandidates } from "./client";
import { BASE_USDC_ADDRESS } from "@/shared/savings/config";

const liveTest = process.env.MORPHO_LIVE_SMOKE === "1" ? test : test.skip;

liveTest(
  "reads the bounded public Base USDC V1 shortlist with provenance",
  async () => {
    const result = await getMorphoVaultCandidates({ fetchImpl: fetch });

    expect(result.version).toBe("v1");
    expect(result.chainId).toBe(8453);
    expect(result.asset.address.toLowerCase()).toBe(
      BASE_USDC_ADDRESS.toLowerCase(),
    );
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((vault) => vault.source.fetchedAt.length > 0)).toBeTrue();
  },
  15_000,
);
