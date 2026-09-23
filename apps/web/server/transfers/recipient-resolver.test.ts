import { describe, expect, test } from "bun:test";
import {
  ResolverTtlCache,
  parseResolvedRecipientName,
  resolveEnsAddressPreferringBase,
  resolveTransferRecipientLabels,
  resolveTransferRecipientLabelsCached,
  resolveTransferRecipientName,
  resolveTransferRecipientNameCached,
  reverseResolverUrl,
  selectBasenameResolverAddress,
} from "./recipient-resolver";
import { getAddress } from "viem";

const JESSE = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" as const;
const JESSE_LOWER = JESSE.toLowerCase() as `0x${string}`;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

describe("reverseResolverUrl", () => {
  test("targets the bounded reverse-label resolver path", () => {
    expect(reverseResolverUrl(JESSE)).toBe(`https://api.ensideas.com/ens/resolve/${JESSE}`);
  });
});

describe("parseResolvedRecipientName", () => {
  test("reads a normalized name and ignores anything that is not a recipient name", () => {
    expect(parseResolvedRecipientName({ name: "JESSE.BASE.ETH" })).toBe("jesse.base.eth");
    expect(parseResolvedRecipientName({ ens: "vitalik.eth" })).toBe("vitalik.eth");
    expect(parseResolvedRecipientName({ displayName: "jesse" })).toBeNull();
    expect(parseResolvedRecipientName({})).toBeNull();
  });
});

describe("resolveTransferRecipientName", () => {
  test("uses the Base resolver for Basenames and returns a checksummed address", async () => {
    const requested: string[] = [];
    const resolved = await resolveTransferRecipientName("JESSE.BASE.ETH", {
      resolveBasename: async (name) => {
        requested.push(`base:${name}`);
        return JESSE_LOWER;
      },
      resolveEnsName: async (name) => {
        requested.push(`mainnet:${name}`);
        return OTHER;
      },
    });

    expect(resolved).toBe(JESSE);
    expect(requested).toEqual(["base:jesse.base.eth"]);
  });

  test("uses mainnet ENS for other .eth names", async () => {
    const requested: string[] = [];
    const resolved = await resolveTransferRecipientName("vitalik.eth", {
      resolveBasename: async (name) => {
        requested.push(`base:${name}`);
        return JESSE;
      },
      resolveEnsName: async (name) => {
        requested.push(`mainnet:${name}`);
        return OTHER;
      },
    });

    expect(resolved).toBe(OTHER);
    expect(requested).toEqual(["mainnet:vitalik.eth"]);
  });

  test("returns nothing when resolution fails, resolves to zero, or input is unsupported", async () => {
    expect(await resolveTransferRecipientName("jesse.base.eth", {
      resolveBasename: async () => { throw new Error("offline"); },
    })).toBeNull();
    expect(await resolveTransferRecipientName("jesse.base.eth", {
      resolveBasename: async () => "0x0000000000000000000000000000000000000000",
    })).toBeNull();
    expect(await resolveTransferRecipientName("jesse", {
      resolveEnsName: async () => OTHER,
    })).toBeNull();
  });

  test("refuses a timeout outside the supported bound", async () => {
    await expect(resolveTransferRecipientName("jesse.base.eth", { timeoutMs: 0 }))
      .rejects.toThrow("The recipient resolver timeout must be 1-10000ms.");
  });
});

describe("resolveTransferRecipientLabels", () => {
  test("keeps only reverse labels whose forward resolution matches the address", async () => {
    const requested: string[] = [];
    const labels = await resolveTransferRecipientLabels([JESSE_LOWER, JESSE, OTHER], {
      fetchImpl: async (input) => {
        requested.push(String(input));
        return String(input).endsWith(JESSE)
          ? Response.json({ name: "jesse.base.eth" })
          : Response.json({ name: "spoofed.eth" });
      },
      resolveName: async (name) => name === "jesse.base.eth" ? JESSE : JESSE,
    });

    expect(labels.size).toBe(1);
    expect(labels.get(JESSE)).toBe("jesse.base.eth");
    expect(labels.get(OTHER)).toBeUndefined();
    expect(requested).toHaveLength(2);
  });

  test("bounds reverse lookups and tolerates resolver failures", async () => {
    let calls = 0;
    const labels = await resolveTransferRecipientLabels(
      [JESSE, OTHER, "0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444"],
      {
        fetchImpl: async () => {
          calls += 1;
          throw new Error("offline");
        },
      },
    );

    expect(calls).toBe(3);
    expect(labels.size).toBe(0);
  });
});

describe("selectBasenameResolverAddress", () => {
  test("uses the registry resolver and fails closed when none is designated", () => {
    const custom = "0x1234567890123456789012345678901234567890";
    expect(selectBasenameResolverAddress(custom)).toBe(getAddress(custom));
    expect(selectBasenameResolverAddress("0x0000000000000000000000000000000000000000")).toBeNull();
    expect(selectBasenameResolverAddress(null)).toBeNull();
    expect(selectBasenameResolverAddress("not-an-address")).toBeNull();
  });
});

describe("ResolverTtlCache", () => {
  test("expires entries after the ttl and evicts the oldest beyond the cap", () => {
    let now = 0;
    const cache = new ResolverTtlCache<string>(100, 2, () => now);
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
    now = 101;
    expect(cache.get("a")).toBeUndefined();
    now = 200;
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
  });
});

describe("resolveTransferRecipientNameCached", () => {
  test("reuses a resolved name without re-resolving", async () => {
    const name = "cache-hit.base.eth";
    const first = await resolveTransferRecipientNameCached(name, {
      resolveBasename: async () => JESSE_LOWER,
    });
    expect(first).toBe(JESSE);
    const second = await resolveTransferRecipientNameCached(name, {
      resolveBasename: async () => { throw new Error("should not run"); },
    });
    expect(second).toBe(JESSE);
  });

  test("does not cache an unresolved name", async () => {
    const name = "cache-miss.base.eth";
    const first = await resolveTransferRecipientNameCached(name, {
      resolveBasename: async () => "0x0000000000000000000000000000000000000000",
    });
    expect(first).toBeNull();
    const second = await resolveTransferRecipientNameCached(name, {
      resolveBasename: async () => JESSE,
    });
    expect(second).toBe(JESSE);
  });
});

describe("resolveTransferRecipientLabelsCached", () => {
  test("reuses reverse labels and skips the resolver on a cache hit", async () => {
    const address = "0x5555555555555555555555555555555555555555" as const;
    let calls = 0;
    const first = await resolveTransferRecipientLabelsCached([address], {
      fetchImpl: async () => { calls += 1; return Response.json({ name: "labelled.base.eth" }); },
      resolveName: async () => address,
    });
    expect([...first.values()]).toEqual(["labelled.base.eth"]);
    const second = await resolveTransferRecipientLabelsCached([address], {
      fetchImpl: async () => { calls += 1; throw new Error("should not run"); },
    });
    expect([...second.values()]).toEqual(["labelled.base.eth"]);
    expect(calls).toBe(1);
  });

  test("caches an address that has no reverse label", async () => {
    const address = "0x6666666666666666666666666666666666666666" as const;
    let calls = 0;
    const first = await resolveTransferRecipientLabelsCached([address], {
      fetchImpl: async () => { calls += 1; return new Response(null, { status: 404 }); },
    });
    expect(first.size).toBe(0);
    const second = await resolveTransferRecipientLabelsCached([address], {
      fetchImpl: async () => { calls += 1; throw new Error("should not run"); },
    });
    expect(second.size).toBe(0);
    expect(calls).toBe(1);
  });
});

describe("resolveEnsAddressPreferringBase", () => {
  const BASE_COIN_TYPE = 2147492101;
  test("prefers the Base coin-type record", async () => {
    const requested: (number | undefined)[] = [];
    const resolved = await resolveEnsAddressPreferringBase(async (coinType) => {
      requested.push(coinType);
      return coinType === BASE_COIN_TYPE ? JESSE : OTHER;
    });
    expect(resolved).toBe(JESSE);
    expect(requested).toEqual([BASE_COIN_TYPE]);
  });

  test("falls back to the default record when the name has no Base record", async () => {
    const requested: (number | undefined)[] = [];
    const resolved = await resolveEnsAddressPreferringBase(async (coinType) => {
      requested.push(coinType);
      return coinType === BASE_COIN_TYPE ? null : OTHER;
    });
    expect(resolved).toBe(OTHER);
    expect(requested).toEqual([BASE_COIN_TYPE, undefined]);
  });
});
