import { describe, expect, test } from "bun:test";
import {
  activityAssets,
} from "@/shared/activity/types";
import {
  ACTIVITY_TOKEN_CODEX_TIMEOUT_MS,
  createActivityTokenMetadataResolver,
} from "./token-metadata";

const USDC = activityAssets.find((asset) => asset.id === "usdc")!;
const EURC = activityAssets.find((asset) => asset.id === "eurc")!;
const VAULT = activityAssets.find((asset) => asset.id === "morpho-steakhouse-usdc")!;
const ZORA = "0x1111111111166b7fe7bd91427724b487980afc69" as const;
const UNKNOWN = "0x4444444444444444444444444444444444444444" as const;

describe("Activity token metadata resolver", () => {
  test("uses the bounded Activity Codex timeout contract", () => {
    expect(ACTIVITY_TOKEN_CODEX_TIMEOUT_MS).toBe(3_000);
  });

  test("uses the full Home registry before Codex and resolves dynamic token decimals", async () => {
    const codexCalls: string[][] = [];
    let rpcCalls = 0;
    const resolve = createActivityTokenMetadataResolver({
      codexLookup: async (addresses) => {
        codexCalls.push([...addresses]);
        return new Map([
          [ZORA, {
            address: ZORA,
            name: "Zora",
            symbol: " ZORA ",
            decimals: 18,
          }],
        ]);
      },
      rpcLookup: async () => {
        rpcCalls += 1;
        return new Map();
      },
    });

    const result = await resolve([
      USDC.tokenAddress.toLowerCase() as `0x${string}`,
      EURC.tokenAddress.toLowerCase() as `0x${string}`,
      VAULT.tokenAddress.toLowerCase() as `0x${string}`,
      ZORA,
    ]);

    expect(codexCalls).toEqual([[ZORA]]);
    expect(rpcCalls).toBe(0);
    expect(result.metadata.get(USDC.tokenAddress.toLowerCase())).toEqual({
      assetId: "usdc",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
    });
    expect(result.metadata.get(EURC.tokenAddress.toLowerCase())).toEqual({
      assetId: "eurc",
      tokenSymbol: "EURC",
      tokenDecimals: 6,
    });
    expect(result.metadata.get(VAULT.tokenAddress.toLowerCase())).toEqual({
      assetId: VAULT.id,
      tokenSymbol: VAULT.symbol,
      tokenDecimals: 18,
    });
    expect(result.metadata.get(ZORA)).toEqual({
      assetId: null,
      tokenSymbol: "ZORA",
      tokenDecimals: 18,
    });
  });

  test("keeps unknown metadata on Codex and RPC infrastructure failures", async () => {
    const resolve = createActivityTokenMetadataResolver({
      codexLookup: async () => {
        throw new Error("codex unavailable");
      },
      rpcLookup: async () => {
        throw new Error("configured RPC is not Base mainnet");
      },
    });
    const result = await resolve([UNKNOWN]);
    expect(result.metadata.get(UNKNOWN)).toEqual({
      assetId: null,
      tokenSymbol: null,
      tokenDecimals: null,
    });
    expect(result.nftLikeContracts.size).toBe(0);
  });

  test("nulls invalid, spoofed, and conflicting dynamic metadata", async () => {
    const controls = "0x5555555555555555555555555555555555555555" as const;
    const spoof = "0x6666666666666666666666666666666666666666" as const;
    const conflict = "0x7777777777777777777777777777777777777777" as const;
    const resolve = createActivityTokenMetadataResolver({
      codexLookup: async () => new Map([
        [controls, { address: controls, name: "bad", symbol: "BAD\u200b", decimals: 18 }],
        [spoof, { address: spoof, name: "spoof", symbol: "usdc", decimals: 6 }],
        [conflict, { address: conflict, name: "conflict", symbol: "BAD\u0001", decimals: 6 }],
      ]),
      rpcLookup: async (addresses) => new Map(addresses.map((address) => [
        address,
        address === conflict
          ? { kind: "metadata" as const, symbol: "REAL", decimals: 18 }
          : address === spoof
            ? { kind: "nft-like" as const }
            : { kind: "unknown" as const },
      ])),
    });
    const result = await resolve([controls, spoof, conflict]);
    for (const address of [controls, spoof, conflict]) {
      expect(result.metadata.get(address)).toEqual({
        assetId: null,
        tokenSymbol: null,
        tokenDecimals: null,
      });
    }
    expect(result.nftLikeContracts.has(spoof)).toBe(false);
  });

  test("drops only contracts positively classified by a decimals revert", async () => {
    const resolve = createActivityTokenMetadataResolver({
      codexLookup: async () => new Map(),
      rpcLookup: async () => new Map([
        [UNKNOWN, { kind: "nft-like" }],
        [ZORA, { kind: "unknown" }],
      ]),
    });
    const result = await resolve([UNKNOWN, ZORA]);
    expect(result.nftLikeContracts).toEqual(new Set([UNKNOWN]));
    expect(result.metadata.get(ZORA)?.tokenSymbol).toBeNull();
  });
});
