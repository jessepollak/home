import { describe, expect, test } from "bun:test";
import {
  activityAssets,
} from "@/shared/activity/types";
import {
  ACTIVITY_ASSET_ICON_WAIT_MS,
  ACTIVITY_TOKEN_CODEX_TIMEOUT_MS,
  createActivityTokenMetadataResolver,
  createLatestAssetIcons,
  type LatestAssetIcons,
} from "./token-metadata";

const USDC = activityAssets.find((asset) => asset.id === "usdc")!;
const EURC = activityAssets.find((asset) => asset.id === "eurc")!;
const VAULT = activityAssets.find((asset) => asset.id === "morpho-steakhouse-usdc")!;
const ZORA = "0x1111111111166b7fe7bd91427724b487980afc69" as const;
const UNKNOWN = "0x4444444444444444444444444444444444444444" as const;

function staticIcons(icons: Record<string, string | null>) {
  const state = { refreshes: 0 };
  const assetIcons: LatestAssetIcons = {
    refresh: async () => { state.refreshes += 1; },
    current: () => icons,
  };
  return { assetIcons, state };
}

describe("Activity token metadata resolver", () => {
  test("uses bounded Activity Codex and curated icon wait contracts", () => {
    expect(ACTIVITY_TOKEN_CODEX_TIMEOUT_MS).toBe(3_000);
    expect(ACTIVITY_ASSET_ICON_WAIT_MS).toBe(750);
  });

  test("uses the full Home registry before Codex and resolves dynamic token decimals", async () => {
    const codexCalls: string[][] = [];
    let rpcCalls = 0;
    const resolve = createActivityTokenMetadataResolver({
      assetIcons: staticIcons({ usdc: "https://icons.example/usdc.svg", eurc: null }).assetIcons,
      codexLookup: async (addresses) => {
        codexCalls.push([...addresses]);
        return new Map([
          [ZORA, {
            address: ZORA,
            name: "Zora",
            symbol: " ZORA ",
            decimals: 18,
            imageUrl: "https://token-media.defined.fi/zora.png",
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
      tokenImageUrl: "https://icons.example/usdc.svg",
    });
    expect(result.metadata.get(EURC.tokenAddress.toLowerCase())).toEqual({
      assetId: "eurc",
      tokenSymbol: "EURC",
      tokenDecimals: 6,
      tokenImageUrl: null,
    });
    expect(result.metadata.get(VAULT.tokenAddress.toLowerCase())).toEqual({
      assetId: VAULT.id,
      tokenSymbol: VAULT.symbol,
      tokenDecimals: 18,
      tokenImageUrl: null,
    });
    expect(result.metadata.get(ZORA)).toEqual({
      assetId: null,
      tokenSymbol: "ZORA",
      tokenDecimals: 18,
      tokenImageUrl: "https://token-media.defined.fi/zora.png",
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
      tokenImageUrl: null,
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
        tokenImageUrl: null,
      });
    }
    expect(result.nftLikeContracts.has(spoof)).toBe(false);
  });

  test("keeps unknown metadata when Codex and RPC both return phishing symbols", async () => {
    const rpcCalls: string[][] = [];
    const resolve = createActivityTokenMetadataResolver({
      codexLookup: async () => new Map([
        [UNKNOWN, { address: UNKNOWN, name: "bad", symbol: "claim-usdc.com", decimals: 18 }],
      ]),
      rpcLookup: async (addresses) => {
        rpcCalls.push([...addresses]);
        return new Map([
          [UNKNOWN, { kind: "metadata" as const, symbol: "U5DC", decimals: 18 }],
        ]);
      },
    });

    const result = await resolve([UNKNOWN]);
    expect(rpcCalls).toEqual([[UNKNOWN]]);
    expect(result.metadata.get(UNKNOWN)).toEqual({
      assetId: null,
      tokenSymbol: null,
      tokenDecimals: null,
      tokenImageUrl: null,
    });
  });

  test("attaches only provider-host images for accepted Codex symbols and never for RPC fallback", async () => {
    const spoof = "0x6666666666666666666666666666666666666666" as const;
    const other = "0x7777777777777777777777777777777777777777" as const;
    const icons = staticIcons({});
    const resolve = createActivityTokenMetadataResolver({
      assetIcons: icons.assetIcons,
      codexLookup: async () => new Map([
        [ZORA, { address: ZORA, name: "Zora", symbol: "ZORA", decimals: 18, imageUrl: "https://evil.example/logo" }],
        [spoof, { address: spoof, name: "Spoof", symbol: "USDC", decimals: 6, imageUrl: "https://media.thegrid.id/spoof" }],
      ]),
      rpcLookup: async () => new Map([
        [spoof, { kind: "metadata" as const, symbol: "TOKEN", decimals: 6 }],
        [other, { kind: "metadata" as const, symbol: "OTHER", decimals: 18 }],
      ]),
    });
    const result = await resolve([ZORA, spoof, other]);
    expect(result.metadata.get(ZORA)?.tokenImageUrl).toBeNull();
    expect(result.metadata.get(spoof)).toMatchObject({ tokenSymbol: "TOKEN", tokenImageUrl: null });
    expect(result.metadata.get(other)).toMatchObject({ tokenSymbol: "OTHER", tokenImageUrl: null });
    expect(icons.state.refreshes).toBe(0);
  });

  test("keeps the latest settled curated icons across failed refreshes", async () => {
    let next: Promise<Record<string, string | null>> = Promise.resolve({ usdc: "https://icons.example/usdc.svg" });
    const icons = createLatestAssetIcons(() => next);
    expect(icons.current()).toEqual({});
    await icons.refresh();
    expect(icons.current()).toEqual({ usdc: "https://icons.example/usdc.svg" });
    next = Promise.reject(new Error("icons unavailable"));
    await icons.refresh();
    expect(icons.current()).toEqual({ usdc: "https://icons.example/usdc.svg" });

    const resolve = createActivityTokenMetadataResolver({ assetIcons: icons });
    expect((await resolve([USDC.tokenAddress])).metadata.get(USDC.tokenAddress.toLowerCase())?.tokenImageUrl)
      .toBe("https://icons.example/usdc.svg");
  });

  test("bounds a pending curated icon read and shares one in-flight read", async () => {
    let reads = 0;
    const icons = createLatestAssetIcons(() => {
      reads += 1;
      return new Promise(() => {});
    });
    const resolve = createActivityTokenMetadataResolver({ assetIcons: icons, iconWaitMs: 5 });
    const first = await resolve([USDC.tokenAddress]);
    expect(first.metadata.get(USDC.tokenAddress.toLowerCase())?.tokenImageUrl).toBeNull();
    const second = await resolve([USDC.tokenAddress]);
    expect(second.metadata.get(USDC.tokenAddress.toLowerCase())?.tokenImageUrl).toBeNull();
    expect(reads).toBe(1);
  });

  test("attaches curated icons on the first registry-only response when the read settles within the budget", async () => {
    const icons = createLatestAssetIcons(async () => ({ usdc: "https://icons.example/usdc.svg" }));
    const resolve = createActivityTokenMetadataResolver({ assetIcons: icons, iconWaitMs: 1_000 });
    const result = await resolve([USDC.tokenAddress]);
    expect(result.metadata.get(USDC.tokenAddress.toLowerCase())?.tokenImageUrl)
      .toBe("https://icons.example/usdc.svg");
  });

  test("starts Codex alongside the icon read and attaches curated icons on the first mixed response", async () => {
    let markReadStarted: () => void;
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    let finishIcons: ((icons: Record<string, string | null>) => void) | undefined;
    const icons = createLatestAssetIcons(() => {
      markReadStarted();
      return new Promise((resolve) => { finishIcons = resolve; });
    });
    let codexCalls = 0;
    const resolve = createActivityTokenMetadataResolver({
      assetIcons: icons,
      iconWaitMs: 1_000,
      codexLookup: async () => {
        codexCalls += 1;
        return new Map([
          [ZORA, { address: ZORA, name: "Zora", symbol: "ZORA", decimals: 18 }],
        ]);
      },
    });
    const response = resolve([USDC.tokenAddress, ZORA]);
    await readStarted;
    expect(codexCalls).toBe(1);
    expect(finishIcons).toBeDefined();
    finishIcons!({ usdc: "https://icons.example/usdc.svg" });
    const result = await response;
    expect(result.metadata.get(USDC.tokenAddress.toLowerCase())?.tokenImageUrl)
      .toBe("https://icons.example/usdc.svg");
    expect(result.metadata.get(ZORA)?.tokenSymbol).toBe("ZORA");
  });

  test("ignores a rejected curated icon read", async () => {
    const icons = createLatestAssetIcons(async () => {
      throw new Error("icons unavailable");
    });
    const resolve = createActivityTokenMetadataResolver({ assetIcons: icons, iconWaitMs: 1_000 });
    const result = await resolve([USDC.tokenAddress]);
    expect(result.metadata.get(USDC.tokenAddress.toLowerCase())?.tokenImageUrl).toBeNull();
  });

  test("returns before the icon budget when the request aborts", async () => {
    const icons = createLatestAssetIcons(() => new Promise(() => {}));
    const resolve = createActivityTokenMetadataResolver({ assetIcons: icons, iconWaitMs: 1_000 });
    const controller = new AbortController();
    const response = resolve([USDC.tokenAddress], controller.signal);
    controller.abort();
    const result = await response;
    expect(result.metadata.get(USDC.tokenAddress.toLowerCase())?.tokenImageUrl).toBeNull();
  }, 250);

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
