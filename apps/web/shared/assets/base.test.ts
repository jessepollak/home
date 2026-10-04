import { describe, expect, test } from "bun:test";
import {
  BASE_CBBTC,
  BASE_CHAIN_ID,
  BASE_ETH,
  BASE_FUNDING_ASSETS,
  BASE_MORPHO_USDC_VAULTS,
  BASE_USDC,
} from "./base";

// Exact address -> verified onchain `name()` identities, order-sensitive.
// A reordered, swapped, stale, or extra pair must fail this table.
const morphoVaultIdentities = [
  ["0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61", "Gauntlet USDC Prime"],
  ["0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A", "Spark USDC Vault"],
  ["0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183", "Steakhouse USDC"],
] as const;

describe("Base asset catalog", () => {
  test("keeps canonical assets and funding IDs unique", () => {
    expect(BASE_CHAIN_ID).toBe(8453);
    expect(BASE_ETH.decimals).toBe(18);
    expect(BASE_USDC.decimals).toBe(6);
    expect(BASE_CBBTC.decimals).toBe(8);
    expect(new Set(BASE_MORPHO_USDC_VAULTS.map(({ address }) => address.toLowerCase())).size).toBe(3);
    expect(Object.keys(BASE_FUNDING_ASSETS)).toEqual([
      "base:usdc",
      "base:wars",
      "base:wbrl",
      "base:wcop",
      "base:idrx",
    ]);
    expect(BASE_FUNDING_ASSETS["base:usdc"]).toMatchObject({
      address: BASE_USDC.address,
      decimals: BASE_USDC.decimals,
      symbol: BASE_USDC.symbol,
    });
  });

  test("pins every configured Morpho vault address to its verified onchain name", () => {
    expect(
      BASE_MORPHO_USDC_VAULTS.map(({ address, name }) => [address, name]),
    ).toEqual(morphoVaultIdentities.map(([address, name]) => [address, name]));
  });
});
