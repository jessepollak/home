import { describe, expect, test } from "bun:test";
import { parseVaultPosition, type MorphoVaultPosition } from "./positions";

const position: MorphoVaultPosition = {
  version: "v1",
  accountAddress: "0x1111111111111111111111111111111111111111",
  vaultAddress: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
  assetsRaw: "900719925474099312345",
  sharesRaw: "900719925474099312346",
  indexedAt: "2026-10-03T00:00:00.000Z",
  source: { provider: "Base JSON-RPC", blockNumber: "35123456", fetchedAt: "2026-10-03T00:00:00.000Z" },
  withdrawableRaw: null,
  withdrawableNote: "",
};

describe("parseVaultPosition", () => {
  test("preserves exact amounts, zero and unavailable assets", () => {
    expect(parseVaultPosition(position)).toEqual(position);
    expect(parseVaultPosition({ ...position, assetsRaw: "0", sharesRaw: "0" })?.assetsRaw).toBe("0");
    expect(parseVaultPosition({ ...position, assetsRaw: null })?.assetsRaw).toBeNull();
  });

  test.each(Object.keys(position))("rejects an incomplete position missing %s", (key) => {
    const incomplete: Record<string, unknown> = { ...position };
    delete incomplete[key];
    expect(parseVaultPosition(incomplete)).toBeNull();
  });

  test.each([
    { version: "v2" }, { accountAddress: "0x123" }, { vaultAddress: "bad" },
    { assetsRaw: 0 }, { assetsRaw: "01" }, { sharesRaw: "-1" },
    { indexedAt: "invalid" }, { source: { ...position.source, blockNumber: "-1" } },
    { source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt: position.indexedAt } },
    { withdrawableRaw: "0" },
  ])("rejects malformed positions %p", (override) => {
    expect(parseVaultPosition({ ...position, ...override })).toBeNull();
  });

  test("accepts the position-specific GraphQL source", () => {
    expect(parseVaultPosition({ ...position, source: {
      provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaultPosition", fetchedAt: position.indexedAt,
    } })).not.toBeNull();
  });
});
