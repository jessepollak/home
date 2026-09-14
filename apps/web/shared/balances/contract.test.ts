import { describe, expect, test } from "bun:test";
import { BalancesResponseError, expectedRegistryHoldings, parseBalancesSnapshot } from "./contract";
import {
  FIXTURE_CATALOG,
  FIXTURE_OWNER_ADDRESS,
  FIXTURE_WALLET_TOKEN,
  balancesSnapshotFixture,
  buildBalancesSnapshotFixture,
  catalogHolding,
  priced,
  ready,
  walletHolding,
} from "./fixtures";
import type { BalancesSession, BalancesSnapshot } from "./types";

const session: BalancesSession = {
  subject: "cdp:user-1",
  smartAccountAddress: FIXTURE_OWNER_ADDRESS,
  chainId: 8453,
};

function clone(snapshot: BalancesSnapshot): BalancesSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as BalancesSnapshot;
}

describe("parseBalancesSnapshot", () => {
  test("accepts the reference fixture and returns an equal snapshot", () => {
    const parsed = parseBalancesSnapshot(clone(balancesSnapshotFixture), session, "US");
    expect(parsed).toEqual(balancesSnapshotFixture);
  });

  test("accepts a GLOBAL region snapshot with no quote currency", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "GLOBAL" });
    expect(snapshot.quoteCurrency).toBeNull();
    expect(snapshot.total.status).toBe("no-quote-currency");
    expect(parseBalancesSnapshot(clone(snapshot), session, "GLOBAL")).toEqual(snapshot);
  });

  test("accepts a non-USD region where USDC carries its own USD cash value", () => {
    const snapshot = buildBalancesSnapshotFixture({
      region: "DE",
      registry: {
        usdc: {
          balance: ready("1000000"),
          value: priced("EUR", "92"),
          cashValue: { status: "priced", currency: "USD", amount: { atoms: "100", scale: 2 } },
        },
      },
      total: { status: "complete", value: { atoms: "92", scale: 2 }, currency: "EUR" },
    });
    const parsed = parseBalancesSnapshot(clone(snapshot), session, "DE");
    const usdc = parsed.holdings.find((holding) => holding.id === "usdc");
    expect(usdc?.cashValue).toEqual({ status: "priced", currency: "USD", amount: { atoms: "100", scale: 2 } });
  });

  test("accepts a wallet-discovered row alongside catalog rows", () => {
    const snapshot = buildBalancesSnapshotFixture({
      catalog: [
        catalogHolding(FIXTURE_CATALOG.priced, "1000000000000000000", priced("USD", "146")),
        walletHolding(FIXTURE_WALLET_TOKEN, "2500000000000000000", {
          status: "unpriced",
          reason: "below-market-gate",
        }),
      ],
    });
    const parsed = parseBalancesSnapshot(clone(snapshot), session, "US");
    const discovered = parsed.holdings.find((holding) => holding.source === "wallet");
    expect(discovered?.id).toBe(`wallet:${FIXTURE_WALLET_TOKEN.address}`);
    expect(discovered?.imageUrl).toBe(FIXTURE_WALLET_TOKEN.imageUrl);
  });

  test("accepts an https image on a registry Invest row and a stale flag", () => {
    const snapshot = clone(balancesSnapshotFixture);
    snapshot.holdings = snapshot.holdings.map((h) =>
      h.id === "cbbtc" ? { ...h, imageUrl: "https://icons.example.invalid/cbbtc.png" } : h,
    );
    snapshot.stale = true;
    const parsed = parseBalancesSnapshot(clone(snapshot), session, "US");
    expect(parsed.holdings.find((h) => h.id === "cbbtc")?.imageUrl).toBe("https://icons.example.invalid/cbbtc.png");
    expect(parsed.stale).toBe(true);
  });

  test("carries every registry asset plus the catalog rows", () => {
    const registryIds = [...expectedRegistryHoldings().keys()];
    const parsed = parseBalancesSnapshot(clone(balancesSnapshotFixture), session, "US");
    const ids = new Set(parsed.holdings.map((holding) => holding.id));
    for (const id of registryIds) expect(ids.has(id)).toBe(true);
    expect(parsed.holdings.filter((holding) => holding.source === "catalog")).toHaveLength(3);
    expect(registryIds).toContain("usdc");
    expect(registryIds).toContain("eth");
    expect(registryIds).toContain("morpho-steakhouse-usdc");
  });

  type Rejection = {
    label: string;
    mutate: (snapshot: BalancesSnapshot) => unknown;
    session?: BalancesSession;
    region?: "US" | "DE";
  };
  const rejections: Rejection[] = [
    { label: "wrong version", mutate: (s) => ({ ...s, version: 2 }) },
    { label: "owner mismatch", mutate: (s) => s, session: { ...session, smartAccountAddress: "0x2222222222222222222222222222222222222222" } },
    { label: "region mismatch", mutate: (s) => s, region: "DE" },
    { label: "quote currency mismatch", mutate: (s) => ({ ...s, quoteCurrency: "EUR" }) },
    { label: "bad block hash", mutate: (s) => ({ ...s, block: { ...s.block, hash: "0xabc" } }) },
    { label: "non-ISO fetchedAt", mutate: (s) => ({ ...s, fetchedAt: "2026-09-13" }) },
    { label: "missing registry holding", mutate: (s) => ({ ...s, holdings: s.holdings.filter((h) => h.id !== "usdc") }) },
    { label: "duplicate holding key", mutate: (s) => ({ ...s, holdings: [...s.holdings, s.holdings[0]] }) },
    {
      label: "registry metadata drift",
      mutate: (s) => ({ ...s, holdings: s.holdings.map((h) => (h.id === "usdc" ? { ...h, decimals: 18 } : h)) }),
    },
    {
      label: "cash registry row claiming an image",
      mutate: (s) => ({ ...s, holdings: s.holdings.map((h) => (h.id === "usdc" ? { ...h, imageUrl: "https://x.invalid/a.png" } : h)) }),
    },
    {
      label: "native registry row claiming an image",
      mutate: (s) => ({ ...s, holdings: s.holdings.map((h) => (h.id === "eth" ? { ...h, imageUrl: "https://x.invalid/a.png" } : h)) }),
    },
    {
      label: "registry Invest row with a non-https image",
      mutate: (s) => ({ ...s, holdings: s.holdings.map((h) => (h.id === "cbbtc" ? { ...h, imageUrl: "http://x.invalid/a.png" } : h)) }),
    },
    {
      label: "stale flag that is not true",
      mutate: (s) => ({ ...s, stale: false }),
    },
    {
      label: "unavailable balance coerced to zero",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) =>
          h.id === "toshi" ? { ...h, balance: { status: "unavailable", baseUnits: "0" } } : h,
        ),
      }),
    },
    {
      label: "unavailable balance with a priced value",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) => (h.id === "toshi" ? { ...h, value: priced("USD", "1") } : h)),
      }),
    },
    {
      label: "priced value in the wrong currency",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) => (h.id === "eth" ? { ...h, value: priced("EUR", "1") } : h)),
      }),
    },
    {
      label: "priced value with a float amount",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) =>
          h.id === "eth" ? { ...h, value: { ...priced("USD", "1"), amount: { atoms: "1.5", scale: 2 } } } : h,
        ),
      }),
    },
    {
      label: "cash value on a non-cash asset",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) =>
          h.id === "eth" ? { ...h, cashValue: { status: "priced", currency: "USD", amount: { atoms: "1", scale: 2 } } } : h,
        ),
      }),
    },
    {
      label: "cash value in the wrong denomination",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) =>
          h.id === "usdc" ? { ...h, cashValue: { status: "priced", currency: "EUR", amount: { atoms: "1", scale: 2 } } } : h,
        ),
      }),
    },
    {
      label: "vault without underlying",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) => {
          if (h.id !== "morpho-steakhouse-usdc") return h;
          const rest: Record<string, unknown> = { ...h };
          delete rest.underlying;
          delete rest.underlyingBalance;
          return rest;
        }),
      }),
    },
    { label: "catalog zero balance", mutate: (s) => ({ ...s, holdings: [...s.holdings, catalogHolding({ ...FIXTURE_CATALOG.priced, address: "0x4444444444444444444444444444444444444444" }, "0", priced("USD", "0"))] }) },
    {
      label: "catalog row colliding with a registry contract",
      mutate: (s) => {
        const usdc = s.holdings.find((h) => h.id === "usdc")!;
        return {
          ...s,
          holdings: [
            ...s.holdings,
            catalogHolding({ ...FIXTURE_CATALOG.priced, address: usdc.contractAddress! }, "1", priced("USD", "1")),
          ],
        };
      },
    },
    {
      label: "catalog row with a non-https image",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) =>
          h.id === `catalog:${FIXTURE_CATALOG.priced.address}` ? { ...h, imageUrl: "http://x.invalid/a.png" } : h,
        ),
      }),
    },
    {
      label: "catalog row with a cash currency",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) =>
          h.id === `catalog:${FIXTURE_CATALOG.priced.address}` ? { ...h, cashCurrency: "USD" } : h,
        ),
      }),
    },
    {
      label: "catalog row with a checksummed address",
      mutate: (s) => ({
        ...s,
        holdings: s.holdings.map((h) =>
          h.id === `catalog:${FIXTURE_CATALOG.priced.address}`
            ? { ...h, contractAddress: h.contractAddress!.toUpperCase().replace("0X", "0x") }
            : h,
        ),
      }),
    },
    { label: "coverage.registry disagrees with holdings", mutate: (s) => ({ ...s, coverage: { ...s.coverage, registry: "complete" } }) },
    { label: "unknown coverage.catalog", mutate: (s) => ({ ...s, coverage: { ...s.coverage, catalog: "partial" } }) },
    { label: "partial total without a value", mutate: (s) => ({ ...s, total: { ...s.total, value: null } }) },
    { label: "unavailable total with a value", mutate: (s) => ({ ...s, total: { status: "unavailable", value: { atoms: "1", scale: 2 }, currency: "USD" } }) },
    { label: "total in the wrong currency", mutate: (s) => ({ ...s, total: { ...s.total, currency: "EUR" } }) },
    {
      label: "wallet row claiming a catalog id",
      mutate: (s) => ({
        ...s,
        holdings: [
          ...s.holdings,
          { ...walletHolding(FIXTURE_WALLET_TOKEN, "1", priced("USD", "1")), id: `catalog:${FIXTURE_WALLET_TOKEN.address}` },
        ],
      }),
    },
    { label: "unknown holding source", mutate: (s) => ({ ...s, holdings: s.holdings.map((h) => (h.id === "eth" ? { ...h, source: "indexer" } : h)) }) },
    { label: "not an object", mutate: () => "nope" },
  ];

  test.each(rejections)("rejects $label", (rejection: Rejection) => {
    const tampered = rejection.mutate(clone(balancesSnapshotFixture));
    expect(() =>
      parseBalancesSnapshot(tampered, rejection.session ?? session, rejection.region ?? "US"),
    ).toThrow(BalancesResponseError);
  });

  test("rejects a no-quote-currency total when the region has a currency", () => {
    const snapshot = clone(balancesSnapshotFixture);
    snapshot.total = { status: "no-quote-currency", value: null, currency: null };
    expect(() => parseBalancesSnapshot(snapshot, session, "US")).toThrow(BalancesResponseError);
  });

  test("rejects a priced value when the region has no quote currency", () => {
    const snapshot = buildBalancesSnapshotFixture({ region: "GLOBAL" });
    const tampered = clone(snapshot);
    tampered.holdings = tampered.holdings.map((h) => (h.id === "eth" ? { ...h, value: priced("USD", "1") } : h));
    expect(() => parseBalancesSnapshot(tampered, session, "GLOBAL")).toThrow(BalancesResponseError);
  });
});
