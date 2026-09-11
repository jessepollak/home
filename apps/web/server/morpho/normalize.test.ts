import { describe, expect, test } from "bun:test";
import { BASE_USDC_ADDRESS } from "@/shared/savings/config";
import { parseLosslessJson } from "./lossless-json";
import {
  MorphoSchemaError,
  normalizeVaultCandidate,
} from "./normalize";
import type { MorphoSource } from "@/shared/savings/types";

const source: MorphoSource = {
  provider: "Morpho GraphQL",
  endpoint: "https://api.morpho.org/graphql",
  query: "vaults",
  fetchedAt: "2026-09-07T20:00:00.000Z",
};

const configuredVault = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61";

const invalidRates: Array<
  [field: "apy" | "netApy" | "fee", description: string, value: unknown]
> = [
  ["netApy", "boolean false", false],
  ["fee", "an empty string", ""],
  ["apy", "an array", []],
  ["apy", "an object", {}],
  ["apy", "whitespace", " "],
  ["apy", "a padded numeric string", " 0.04"],
  ["apy", "infinity", Number.POSITIVE_INFINITY],
];

function validVault() {
  return {
    address: configuredVault,
    name: "Gauntlet USDC Prime",
    symbol: "gtUSDCp",
    listed: true,
    chain: { id: "8453" },
    asset: {
      address: BASE_USDC_ADDRESS as string,
      symbol: "USDC",
      decimals: "6",
    },
    state: {
      timestamp: "1788811200",
      blockNumber: "35123456",
      apy: 0.04,
      netApy: 0.035,
      fee: 0,
      curator: "0x9E33faAE38ff641094fa68c65c2cE600b3410585",
      totalAssets: "1000000",
    },
    liquidity: { underlying: "750000" },
  };
}

describe("Morpho V1 normalization", () => {
  test("preserves a uint256 without routing it through Number", () => {
    const uint256 =
      "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const parsed = parseLosslessJson(
      JSON.stringify(validVault()).replace('"1000000"', uint256),
    );

    const result = normalizeVaultCandidate(parsed, source);

    expect(result?.totalAssetsRaw).toBe(uint256);
  });

  test("rejects candidates on the wrong chain or underlying", () => {
    const wrongChain = validVault();
    wrongChain.chain.id = "1";
    expect(normalizeVaultCandidate(wrongChain, source)).toBeNull();

    const wrongUnderlying = validVault();
    wrongUnderlying.asset.address =
      "0x1111111111111111111111111111111111111111";
    expect(normalizeVaultCandidate(wrongUnderlying, source)).toBeNull();
  });

  test.each(invalidRates)(
    "rejects state.%s when it is %s",
    (field, _description, value) => {
      const vault = validVault();
      (vault.state as Record<string, unknown>)[field] = value;

      expect(() => normalizeVaultCandidate(vault, source)).toThrow(
        MorphoSchemaError,
      );
    },
  );

  test("accepts finite numbers and explicit numeric strings, including zero", () => {
    const vault = validVault();
    (vault.state as Record<string, unknown>).apy = "0.04";
    (vault.state as Record<string, unknown>).netApy = "0";
    (vault.state as Record<string, unknown>).fee = "1e-3";

    const result = normalizeVaultCandidate(vault, source);

    expect(result?.grossApy).toBe(0.04);
    expect(result?.netApy).toBe(0);
    expect(result?.feeRate).toBe(0.001);
  });

  test("keeps missing values distinct from reported zero values", () => {
    const missing = validVault();
    delete (missing.state as Partial<typeof missing.state>).totalAssets;
    delete (missing.state as Partial<typeof missing.state>).fee;
    delete (missing as Partial<typeof missing>).liquidity;

    const missingResult = normalizeVaultCandidate(missing, source);
    expect(missingResult?.totalAssetsRaw).toBeNull();
    expect(missingResult?.feeRate).toBeNull();
    expect(missingResult?.liquidityRaw).toBeNull();

    const zero = validVault();
    zero.state.totalAssets = "0";
    zero.state.netApy = 0;
    zero.state.fee = 0;
    zero.liquidity.underlying = "0";

    const zeroResult = normalizeVaultCandidate(zero, source);
    expect(zeroResult?.totalAssetsRaw).toBe("0");
    expect(zeroResult?.netApy).toBe(0);
    expect(zeroResult?.feeRate).toBe(0);
    expect(zeroResult?.liquidityRaw).toBe("0");
  });

  test("fails closed when a V2 shape reaches the V1 adapter", () => {
    expect(() =>
      normalizeVaultCandidate(
        {
          address: configuredVault,
          avgNetApy: 0.04,
          totalAssets: "1000",
        },
        source,
      ),
    ).toThrow(MorphoSchemaError);
  });
});
