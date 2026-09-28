import { describe, expect, test } from "bun:test";
import { getDirectPortfolioAssets, PORTFOLIO_USDC_ADDRESS, portfolioVaults } from "@/config/portfolio-assets";
import { stockAssets } from "@/config/invest-assets";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { erc20AssetKey, nativeAssetKey, type BalancesTotal } from "@/shared/balances/types";
import { contractHistoryAsset, HISTORY_WETH_ADDRESS, morphoHistoryAssets, nativeHistoryAsset } from "./assets";
import { createHistoryReader } from "./read";
import { historyInventoryFromSnapshot } from "./reconcile";
import type { ChainBucket, HistoryAsset } from "./types";

type Deps = Parameters<typeof createHistoryReader>[0];
type Quantity = { status: "ready"; baseUnits: bigint } | { status: "unavailable"; reason: "pending-read" | "mismatch" | "unsupported" };
const base = new Date("2026-01-02T00:00:00.000Z");
const time = (hour: number) => new Date(base.getTime() + hour * 3_600_000);
const bucket = (hour: number): ChainBucket => ({ bucketAt: time(hour), blockNumber: BigInt(100 + hour), blockHash: "0x01", blockTime: time(hour) });
const usdc = erc20AssetKey(PORTFOLIO_USDC_ADDRESS);
const eurc = getDirectPortfolioAssets().find((asset) => asset.symbol === "EURC")!.contractAddress!;
const eurcKey = erc20AssetKey(eurc);
const eth = nativeAssetKey();
const weth = erc20AssetKey(HISTORY_WETH_ADDRESS);
const vault = erc20AssetKey(portfolioVaults[0]!.address);
const market = BORROW_MARKETS[0]!;
const [collateral, borrow] = morphoHistoryAssets(market.marketId);
const stock = erc20AssetKey(stockAssets[0]!.contractAddress);
const unknownAddress = "0x1111111111111111111111111111111111111111";
const unknown = erc20AssetKey(unknownAddress);
const b = (value: string) => BigInt(value);
const ready = (value: string): Quantity => ({ status: "ready", baseUnits: b(value) });
const configured: HistoryAsset[] = [nativeHistoryAsset(), ...getDirectPortfolioAssets().flatMap((asset) =>
  asset.contractAddress ? [contractHistoryAsset(asset.contractAddress)] : []),
  ...portfolioVaults.map((item) => contractHistoryAsset(item.address)),
  ...BORROW_MARKETS.flatMap((item) => morphoHistoryAssets(item.marketId))];

function cents(total: BalancesTotal): bigint | null {
  return total.value === null ? null : BigInt(total.value.atoms) * BigInt(100) / BigInt(10) ** BigInt(total.value.scale);
}

function fixture(options: {
  snapshots?: Record<string, Quantity>[];
  times?: number[];
  catalog?: Map<string, { name: string; symbol: string; decimals: number }> | null;
  missing?: string[];
  provisional?: string[];
  fx?: string | null;
  finalized?: number;
  windowStart?: number;
  omit?: string[];
  inventory?: "complete" | "incomplete";
  heldAssets?: HistoryAsset[];
  extraAssets?: HistoryAsset[];
} = {}) {
  const snapshots = options.snapshots ?? [{}];
  const times = options.times ?? snapshots.map((_, index) => index);
  const declared = [...configured, ...Object.keys(snapshots.reduce<Record<string, Quantity>>((all, snapshot) =>
    ({ ...all, ...snapshot }), {})).filter((key) => !configured.some((asset) => asset.key === key))
    .map((key) => contractHistoryAsset(key.slice(key.lastIndexOf(":") + 1))), ...options.extraAssets ?? []];
  const assets = [...new Map(declared.map((asset) => [asset.key, asset])).values()];
  const calls: { readBuckets: ChainBucket[]; heldAssets: HistoryAsset[] | undefined; fill: Parameters<Deps["series"]["fill"]>[0] | null } = { readBuckets: [], heldAssets: undefined, fill: null };
  const deps = {
    chain: { finalizedHead: async () => ({ number: BigInt(100 + (options.finalized ?? 24)), hash: "0x01", timestamp: time(options.finalized ?? 24).getTime() / 1_000 }) },
    ingest: {
      enroll: async () => ({ windowStartAt: time(options.windowStart ?? 0), windowStartBlock: BigInt(100 + (options.windowStart ?? 0)) }),
      readQuantities: async (_address: string, request: { buckets: ChainBucket[]; heldAssets?: HistoryAsset[] }) => {
        calls.readBuckets = request.buckets;
        calls.heldAssets = request.heldAssets;
        return assets.filter((asset) => !options.omit?.includes(asset.key)).map((asset) => ({ asset, segments: [], buckets: request.buckets.map((item) => ({ bucket: item,
          quantity: snapshots[times.indexOf((item.bucketAt.getTime() - base.getTime()) / 3_600_000)]?.[asset.key] ?? ready("0") })) }));
      },
    },
    series: {
      ensureBuckets: async (bucketTimes: readonly Date[]) => bucketTimes.map((item) => bucket((item.getTime() - base.getTime()) / 3_600_000)),
      fill: async (request: Parameters<Deps["series"]["fill"]>[0]) => {
        calls.fill = request;
        const result = new Map<string, Map<number, { status: "ready"; value: { atoms: bigint; scale: number }; provisional: boolean } | { status: "none" }>>();
        const values: Record<string, { atoms: bigint; scale: number }> = {
          [`close:${PORTFOLIO_USDC_ADDRESS.toLowerCase()}`]: { atoms: BigInt(1), scale: 0 },
          [`close:${eurc.toLowerCase()}`]: { atoms: BigInt(1), scale: 0 },
          [`close:${HISTORY_WETH_ADDRESS}`]: { atoms: BigInt(3000), scale: 0 },
          [`close:${market.collateralToken.address.toLowerCase()}`]: { atoms: BigInt(100000), scale: 0 },
          [`morpho-borrow-index:${market.marketId.toLowerCase()}`]: { atoms: BigInt(1), scale: 0 },
          [`vault-rate:${portfolioVaults[0]!.address.toLowerCase()}`]: { atoms: b("1000000"), scale: 18 },
          "fx:USD:EUR": { atoms: BigInt(91), scale: 2 },
          [`close:${unknownAddress}`]: { atoms: BigInt(9), scale: 0 },
        };
        for (const key of [...request.closeContracts.map((address) => `close:${address}`),
          ...request.vaults.map((address) => `vault-rate:${address}`),
          ...request.marketIds.map((id) => `morpho-borrow-index:${id}`),
          ...request.fxCurrencies.map((currency) => `fx:USD:${currency}`)]) {
          result.set(key, new Map(request.buckets.map((item) => [item.bucketAt.getTime(),
            options.missing?.includes(key) || !values[key] ? { status: "none" as const } :
              { status: "ready" as const, value: values[key], provisional: options.provisional?.includes(key) ?? false }])));
        }
        return result;
      },
    },
    catalog: async () => options.catalog === undefined ? new Map() : options.catalog,
  } as unknown as Deps;
  return { reader: createHistoryReader(deps), calls, times: times.map(time) };
}

async function values(options: Parameters<typeof fixture>[0]) {
  const { reader, times, calls } = fixture(options);
  const result = await reader.readPoints("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
    bucketTimes: times, granularity: "1h", quoteCurrency: options?.fx === undefined ? "USD" : "EUR",
    maxArchiveReads: 2,
    inventory: options?.inventory ?? "complete",
    heldAssets: options?.heldAssets ?? [],
  });
  return { ...result, calls };
}

describe("history reader", () => {
  test("forwards snapshot-held assets to ingest", async () => {
    const heldAssets = [nativeHistoryAsset()];
    const result = await values({ heldAssets });
    expect(result.calls.heldAssets).toEqual([nativeHistoryAsset()]);
  });

  test("deposit increases Cash and net at finalized buckets", async () => {
    const result = await values({ snapshots: [{ [usdc]: ready("100000000") }, { [usdc]: ready("125000000") }] });
    expect(result.usableFrom).toEqual(time(0));
    expect(result.points.map((point) => [cents(point.value.cash), cents(point.value.net), point.value.coverage]))
      .toEqual([[b("10000"), b("10000"), "complete"], [b("12500"), b("12500"), "complete"]]);
    expect(result.calls.fill?.closeContracts).toContain(PORTFOLIO_USDC_ADDRESS.toLowerCase() as `0x${string}`);
  });

  test("no snapshot leaves exact priced quantities partial", async () => {
    const result = await values({ snapshots: [{ [usdc]: ready("1000000"), [eth]: ready("1000000000000000000") }],
      inventory: historyInventoryFromSnapshot(null).inventory });
    expect(result.points[0]?.value.cash.status).toBe("complete");
    expect(result.points[0]?.value.investments.status).toBe("partial");
    expect(result.points[0]?.value.net.status).toBe("partial");
    expect(result.points[0]?.value.coverage).toBe("partial");
    expect(result.points[0]?.value.missing).toEqual([]);
  });

  test("an incomplete snapshot catalog leaves exact priced quantities partial", async () => {
    const inventory = historyInventoryFromSnapshot({ coverage: { registry: "complete", catalog: "incomplete" }, holdings: [] }).inventory;
    const result = await values({ snapshots: [{ [eth]: ready("1000000000000000000") }], inventory });
    expect(result.points[0]?.value.investments.status).toBe("partial");
    expect(result.points[0]?.value.net.status).toBe("partial");
    expect(result.points[0]?.value.coverage).toBe("partial");
  });

  test("archive reference quantities share point pricing and ETH-weighted valuation", async () => {
    const { reader, times } = fixture({ snapshots: [{ [usdc]: ready("1000000"), [eth]: ready("1000000000000000000") }] });
    const history = await reader.readPoints("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
      bucketTimes: times, granularity: "1h", quoteCurrency: "USD", maxArchiveReads: 0,
      inventory: "complete",
      heldAssets: [],
    });
    const block = history.points[0]!.blockNumber;
    const reference = await reader.readPoints("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
      bucketTimes: times, granularity: "1h", quoteCurrency: "USD", maxArchiveReads: 0,
      inventory: "complete",
      heldAssets: [],
      referenceQuantities: new Map([[block, new Map([[usdc, ready("2000000")], [eth, ready("2000000000000000000")]])]]),
    });
    expect(cents(history.points[0]!.value.net)).toBe(b("300100"));
    expect(cents(reference.points[0]!.value.net)).toBe(b("600200"));
    expect(cents({ status: "complete", currency: "USD", value: history.points[0]!.ethWeightedValue })).toBe(b("300000"));
    expect(cents({ status: "complete", currency: "USD", value: reference.points[0]!.ethWeightedValue })).toBe(b("600000"));
  });

  test("Save exchanges Cash for vault shares without changing net", async () => {
    const result = await values({ snapshots: [{ [usdc]: ready("10000000") }, { [vault]: ready("10000000000000000000") }] });
    expect(result.points.map((point) => [cents(point.value.cash), cents(point.value.net)]))
      .toEqual([[b("1000"), b("1000")], [b("1000"), b("1000")]]);
    expect(result.calls.fill?.vaults).toContain(portfolioVaults[0]!.address.toLowerCase() as `0x${string}`);
  });

  test("borrowing raises Cash and debt equally; liquidation reduces collateral and debt", async () => {
    const result = await values({ snapshots: [
      { [collateral.key]: ready("1000000") },
      { [collateral.key]: ready("1000000"), [borrow.key]: ready("200000000"), [usdc]: ready("200000000") },
      { [collateral.key]: ready("500000"), [borrow.key]: ready("150000000"), [usdc]: ready("200000000") },
    ] });
    expect(result.points.map((point) => [cents(point.value.cash), cents(point.value.investments),
      cents(point.value.borrow), cents(point.value.net)]))
      .toEqual([[b("0"), b("100000"), b("0"), b("100000")],
        [b("20000"), b("100000"), b("20000"), b("100000")],
        [b("20000"), b("50000"), b("15000"), b("55000")]]);
    expect(result.calls.fill?.marketIds).toContain(market.marketId.toLowerCase() as `0x${string}`);
  });

  test("trade and ETH wrap preserve net with a shared WETH close", async () => {
    const trade = await values({ snapshots: [{ [usdc]: ready("3000000000") }, { [eth]: ready("1000000000000000000") }] });
    expect(trade.points.map((point) => [cents(point.value.cash), cents(point.value.investments), cents(point.value.net)]))
      .toEqual([[b("300000"), b("0"), b("300000")], [b("0"), b("300000"), b("300000")]]);
    const wrap = await values({ snapshots: [{ [eth]: ready("1000000000000000000") }, { [weth]: ready("1000000000000000000") }] });
    expect(wrap.points.map((point) => cents(point.value.net))).toEqual([b("300000"), b("300000")]);
    expect(wrap.calls.fill?.closeContracts).toEqual([HISTORY_WETH_ADDRESS]);
  });

  test("recognized catalog tokens use their exact-contract close and catalog decimals", async () => {
    const result = await values({ snapshots: [{ [unknown]: ready("2000000") }],
      catalog: new Map([[unknownAddress, { name: "Token", symbol: "TOK", decimals: 6 }]]) });
    expect(result.points[0]?.value.coverage).toBe("complete");
    expect(cents(result.points[0]!.value.net)).toBe(b("1800"));
    expect(result.calls.fill?.closeContracts).toEqual([unknownAddress]);
  });
  test("held decimals that disagree with the catalog leave the token unpriced", async () => {
    const result = await values({ snapshots: [{ [unknown]: ready("2000000"), [eth]: ready("1000000000000000000") }],
      catalog: new Map([[unknownAddress, { name: "Token", symbol: "TOK", decimals: 6 }]]),
      extraAssets: [contractHistoryAsset(unknownAddress, { decimals: 18 })] });
    expect(result.points[0]?.value.coverage).toBe("partial");
    expect(result.points[0]?.value.missing).toContainEqual({ assetKey: unknown, reason: "unpriced-basis" });
    expect(result.points[0]?.value.investments.status).toBe("partial");
    expect(cents(result.points[0]!.value.net)).toBe(b("300000"));
    expect(result.calls.fill?.closeContracts).not.toContain(unknownAddress);
  });
  test("a removed cash asset stays in Cash with its held scale and denomination", async () => {
    const result = await values({ snapshots: [{ [unknown]: ready("2000000"), [eth]: ready("1000000000000000000") }],
      catalog: new Map([[unknownAddress, { name: "Cash", symbol: "EURC", decimals: 6 }]]),
      extraAssets: [contractHistoryAsset(unknownAddress, { decimals: 6, cashCurrency: "EUR" })] });
    expect(result.points[0]?.value.coverage).toBe("complete");
    expect(cents(result.points[0]!.value.cash)).toBe(b("1800"));
    expect(cents(result.points[0]!.value.investments)).toBe(b("300000"));
    expect(cents(result.points[0]!.value.net)).toBe(b("301800"));
  });

  test("sold-to-zero catalog asset and fully zero account remain complete without a close", async () => {
    const sold = await values({ snapshots: [{ [unknown]: ready("1000000") }, { [unknown]: ready("0") }],
      catalog: new Map([[unknownAddress, { name: "Token", symbol: "TOK", decimals: 6 }]]), missing: [`close:${unknownAddress}`] });
    expect(sold.points[0]?.value.missing).toEqual([{ assetKey: unknown, reason: "no-recent-close" }]);
    expect(sold.points[1]?.value.coverage).toBe("complete");
    expect(cents(sold.points[1]!.value.net)).toBe(b("0"));
    const zero = await values({ snapshots: [{}] });
    expect(zero.points[0]?.value.coverage).toBe("complete");
    expect(cents(zero.points[0]!.value.net)).toBe(b("0"));
    expect(zero.calls.fill?.closeContracts).toEqual([]);
  });

  test("missing USDC close makes Cash partial, not a dollar peg", async () => {
    const result = await values({ snapshots: [{ [usdc]: ready("1000000"), [eurcKey]: ready("1000000") }],
      missing: [`close:${PORTFOLIO_USDC_ADDRESS.toLowerCase()}`] });
    expect(result.points[0]?.value.cash.status).toBe("partial");
    expect(result.points[0]?.value.missing).toContainEqual({ assetKey: usdc, reason: "no-recent-close" });
    expect(cents(result.points[0]!.value.net)).toBe(b("100"));
  });



  test("a tracked market that is no longer configured makes the point partial, never complete", async () => {
    const removed = `morpho:${`0x${"b".repeat(64)}`}:collateral`;
    const result = await values({ snapshots: [{ [removed]: ready("123"), [eth]: ready("1000000000000000000") }],
      extraAssets: [{ key: removed, kind: "morpho-collateral", contractAddress: null, marketId: `0x${"b".repeat(64)}` } as HistoryAsset] });
    expect(result.points[0]?.value.coverage).toBe("partial");
    expect(result.points[0]?.value.missing).toContainEqual({ assetKey: removed, reason: "unsupported" });
  });

  test("a removed vault keeps its unpriced basis even when its contract is in the catalog", async () => {
    const result = await values({ snapshots: [{ [unknown]: ready("1000000"), [eth]: ready("1000000000000000000") }],
      catalog: new Map([[unknownAddress, { name: "Vault", symbol: "vUSDC", decimals: 18 }]]),
      extraAssets: [{ key: unknown, kind: "vault-share", contractAddress: unknownAddress as `0x${string}`, marketId: null }] });
    expect(result.points[0]?.value.coverage).toBe("partial");
    expect(result.points[0]?.value.missing).toContainEqual({ assetKey: unknown, reason: "unpriced-basis" });
    expect(result.calls.fill?.vaults).not.toContain(unknownAddress);
    expect(result.calls.fill?.closeContracts).not.toContain(unknownAddress);
  });

  test("unknown debt from a removed market leaves the point unavailable, not a partial zero", async () => {
    const removed = `morpho:${`0x${"c".repeat(64)}`}:borrow-shares`;
    const result = await values({ snapshots: [{ [removed]: ready("500") }],
      extraAssets: [{ key: removed, kind: "morpho-borrow-shares", contractAddress: null, marketId: `0x${"c".repeat(64)}` } as HistoryAsset] });
    expect(result.points[0]?.value.net.status).toBe("unavailable");
    expect(result.points[0]?.value.net.value).toBeNull();
    expect(result.points[0]?.value.investments.status).toBe("complete");
    expect(result.points[0]?.value.borrow.status).toBe("unavailable");
    expect(result.points[0]?.value.missing).toContainEqual({ assetKey: removed, reason: "unsupported" });
  });
  test("an unconfigured vault share is valued, not dropped from the point", async () => {
    const result = await values({ snapshots: [{ [unknown]: ready("1000000"), [eth]: ready("1000000000000000000") }],
      extraAssets: [{ key: unknown, kind: "vault-share", contractAddress: unknownAddress as `0x${string}`, marketId: null }] });
    expect(result.points[0]?.value.coverage).toBe("partial");
    expect(result.points[0]?.value.missing).toContainEqual({ assetKey: unknown, reason: "below-market-gate" });
    expect(result.calls.fill?.closeContracts).not.toContain(PORTFOLIO_USDC_ADDRESS.toLowerCase());
  });

  test("stock is unpriced, unknown positive token is below gate, pending quantity is not zero", async () => {
    const result = await values({ snapshots: [{ [stock]: ready("100000000"), [unknown]: ready("1000000"), [eth]: ready("1000000000000000000"),
      [usdc]: { status: "unavailable", reason: "pending-read" } }] });
    expect(result.points[0]?.value.missing).toEqual(expect.arrayContaining([
      { assetKey: stock, reason: "unpriced-basis" },
      { assetKey: unknown, reason: "below-market-gate" },
      { assetKey: usdc, reason: "pending-read" },
    ]));
    expect(result.points[0]?.value.coverage).toBe("partial");
    expect(result.calls.fill?.closeContracts).toEqual([HISTORY_WETH_ADDRESS]);
  });

  test("configured assets without any quantity data remain pending, never implicit zero", async () => {
    const result = await values({ snapshots: [{ [eth]: ready("1000000000000000000") }], omit: [usdc] });
    expect(result.points[0]?.value.missing).toContainEqual({ assetKey: usdc, reason: "pending-read" });
    expect(result.points[0]?.value.coverage).toBe("partial");
    expect(cents(result.points[0]!.value.net)).toBe(b("300000"));
  });

  test("provisional series affect only buckets where that value is used", async () => {
    const result = await values({ snapshots: [{ [usdc]: ready("1000000") }, {}], fx: "EUR",
      provisional: [`close:${PORTFOLIO_USDC_ADDRESS.toLowerCase()}`, "fx:USD:EUR"] });
    expect(result.points.map((point) => point.provisional)).toEqual([true, false]);
    expect(result.points[1]?.value.coverage).toBe("complete");
  });

  test("excludes times before window start and after finalized head, and propagates provisional FX", async () => {
    const result = await values({ snapshots: [{}, { [usdc]: ready("1000000") }, {}], times: [0, 1, 3],
      windowStart: 1, finalized: 2, fx: "EUR", provisional: ["fx:USD:EUR"] });
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.bucketAt).toEqual(time(1));
    expect(result.points[0]?.blockNumber).toBe(BigInt(101));
    expect(result.points[0]?.provisional).toBe(true);
    expect(result.points[0]?.value.net).toEqual({ status: "complete", value: { atoms: "910000000000000000", scale: 18 }, currency: "EUR", negative: false });
    expect(result.calls.readBuckets.map((item) => item.bucketAt)).toEqual([time(1)]);
    expect(result.calls.fill?.fxCurrencies).toEqual(["EUR"]);
  });
});
