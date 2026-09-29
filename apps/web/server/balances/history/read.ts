import "server-only";

import { getDirectPortfolioAssets, PORTFOLIO_USDC_ADDRESS, portfolioVaults } from "@/config/portfolio-assets";
import type { FiatCurrencyCode } from "@/config/regions";
import { stockAssets } from "@/config/invest-assets";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { valueHistoryPoint } from "@/shared/balances/history-valuation";
import { erc20AssetKey, type ExactDecimal } from "@/shared/balances/types";
import { HISTORY_WETH_ADDRESS, contractHistoryAsset, morphoHistoryAssets, nativeHistoryAsset } from "./assets";
import type { createHistoryIngest } from "./ingest";
import type { createHistorySeries } from "./series";
import type { Granularity, HexAddress, HistoryAsset, HistoryChainReader } from "./types";

type PointInput = Parameters<typeof valueHistoryPoint>[0];
type AssetInput = PointInput["assets"][number];
type Quantity = AssetInput["quantity"];
type Price = { status: "close"; usdPerToken: ExactDecimal } | { status: "missing"; reason: "no-recent-close" | "unpriced-basis" };
type Position = PointInput["morphoPositions"][number];
type BucketQuantities = Awaited<ReturnType<ReturnType<typeof createHistoryIngest>["readQuantities"]>>;

const directAssets = getDirectPortfolioAssets();
const directByKey = new Map<string, (typeof directAssets)[number]>(directAssets.map((asset) => [asset.assetKey, asset]));
const vaultByKey = new Map<string, (typeof portfolioVaults)[number]>(portfolioVaults.map((vault) => [erc20AssetKey(vault.address), vault]));
const stockContracts = new Set(stockAssets.map((asset) => asset.contractAddress.toLowerCase()));
const configuredAssets: HistoryAsset[] = [
  nativeHistoryAsset(),
  ...directAssets.flatMap((asset) => asset.contractAddress
    ? [contractHistoryAsset(asset.contractAddress, { decimals: asset.decimals, cashCurrency: asset.cashCurrency })] : []),
  ...portfolioVaults.map((vault) => contractHistoryAsset(vault.address, { decimals: vault.decimals })),
  ...BORROW_MARKETS.flatMap((market) => morphoHistoryAssets(market.marketId)),
];
const configuredByKey = new Map(configuredAssets.map((asset) => [asset.key, asset]));

function historyQuantityAt(row: BucketQuantities[number] | undefined, timestamp: number): Quantity {
  const quantity = row?.buckets.find((entry) => entry.bucket.bucketAt.getTime() === timestamp)?.quantity;
  if (quantity?.status === "ready") return { status: "ready", baseUnits: quantity.baseUnits };
  return { status: "unavailable", reason: quantity?.status === "unavailable" ? quantity.reason : "pending-read" };
}

function decimal(value: { atoms: bigint; scale: number }) {
  return { atoms: value.atoms.toString(), scale: value.scale };
}

export function createHistoryReader(deps: {
  ingest: ReturnType<typeof createHistoryIngest>;
  series: ReturnType<typeof createHistorySeries>;
  chain: HistoryChainReader;
  catalog: () => Promise<ReadonlyMap<string, { symbol: string; name: string; decimals: number }> | null>;
}) {
  return {
    async readPoints(address: HexAddress, input: {
      bucketTimes: Date[];
      granularity: Granularity;
      quoteCurrency: FiatCurrencyCode | null;
      inventory: PointInput["inventory"];
      heldAssets: HistoryAsset[];
      maxArchiveReads: number;
      signal?: AbortSignal;
      referenceQuantities?: ReadonlyMap<bigint, ReadonlyMap<string, Quantity>>;
    }): Promise<{ usableFrom: Date | null; points: { bucketAt: Date; blockNumber: bigint; provisional: boolean; value: ReturnType<typeof valueHistoryPoint>; ethWeightedValue: ReturnType<typeof valueHistoryPoint>["net"]["value"] }[] }> {
      const head = await deps.chain.finalizedHead(input.signal);
      const enrolled = await deps.ingest.enroll(address, input.signal);
      if (!enrolled) return { usableFrom: null, points: [] };
      const buckets = (await deps.series.ensureBuckets(input.bucketTimes.filter((time) =>
        time.getTime() >= enrolled.windowStartAt.getTime() && time.getTime() <= head.timestamp * 1_000), head, input.signal))
        .filter((bucket) => bucket.blockNumber >= enrolled.windowStartBlock && bucket.blockNumber <= head.number &&
          bucket.bucketAt.getTime() >= enrolled.windowStartAt.getTime() && bucket.bucketAt.getTime() <= head.timestamp * 1_000);
      if (buckets.length === 0) return { usableFrom: enrolled.windowStartAt, points: [] };

      const quantities = await deps.ingest.readQuantities(address, {
        buckets, maxArchiveReads: input.maxArchiveReads, heldAssets: input.heldAssets, signal: input.signal,
      });
      const byKey = new Map(quantities.map((row) => [row.asset.key, row]));
      const bucketByTime = new Map(buckets.map((bucket) => [bucket.bucketAt.getTime(), bucket.blockNumber]));
      const quantityAt = (row: BucketQuantities[number] | undefined, timestamp: number): Quantity => {
        const block = bucketByTime.get(timestamp);
        return (block === undefined ? undefined : input.referenceQuantities?.get(block)?.get(row?.asset.key ?? "")) ?? historyQuantityAt(row, timestamp);
      };
      const assets = new Map(configuredByKey);
      for (const row of quantities) assets.set(row.asset.key, row.asset);
      const catalog = await deps.catalog();
      const closeContracts = new Set<HexAddress>();
      const vaults = new Set<HexAddress>();
      const marketIds = new Set<HexAddress>();
      let needsFx = false;
      for (const bucket of buckets) {
        const timestamp = bucket.bucketAt.getTime();
        for (const asset of assets.values()) {
          const quantity = quantityAt(byKey.get(asset.key), timestamp);
          if (quantity.status !== "ready" || quantity.baseUnits === BigInt(0)) continue;
          const catalogDecimals = asset.contractAddress ? catalog?.get(asset.contractAddress)?.decimals : undefined;
          if (asset.contractAddress && asset.decimals !== undefined && catalogDecimals !== undefined && asset.decimals !== catalogDecimals) continue;
          if (asset.kind === "native") closeContracts.add(HISTORY_WETH_ADDRESS);
          else if (asset.kind === "vault-share") {
            if (vaultByKey.has(asset.key)) {
              vaults.add(asset.contractAddress);
              closeContracts.add(PORTFOLIO_USDC_ADDRESS.toLowerCase() as HexAddress);
            }
          } else if (asset.kind === "erc20") {
            const contract = asset.contractAddress;
            if (contract === HISTORY_WETH_ADDRESS) closeContracts.add(HISTORY_WETH_ADDRESS);
            else if (!stockContracts.has(contract) && !contract.startsWith("0xb20000000000000000000") &&
              (directByKey.has(asset.key) || catalog?.has(contract))) closeContracts.add(contract);
          } else if (asset.kind === "morpho-borrow-shares") {
            marketIds.add(asset.marketId);
            const market = BORROW_MARKETS.find((entry) => entry.marketId.toLowerCase() === asset.marketId);
            if (market) closeContracts.add(market.loanToken.address.toLowerCase() as HexAddress);
          } else {
            const market = BORROW_MARKETS.find((entry) => entry.marketId.toLowerCase() === asset.marketId);
            if (market) closeContracts.add(market.collateralToken.address.toLowerCase() as HexAddress);
          }
          if (asset.kind === "native" || asset.kind === "vault-share" && vaultByKey.has(asset.key) || asset.kind.startsWith("morpho-") ||
            asset.kind === "erc20" && (asset.contractAddress === HISTORY_WETH_ADDRESS ||
              !stockContracts.has(asset.contractAddress) && !asset.contractAddress.startsWith("0xb20000000000000000000") &&
              (directByKey.has(asset.key) || !!catalog?.has(asset.contractAddress)))) needsFx = true;
        }
      }
      const lookup = await deps.series.fill({
        buckets, granularity: input.granularity, vaults: [...vaults], marketIds: [...marketIds],
        closeContracts: [...closeContracts],
        fxCurrencies: needsFx && input.quoteCurrency ? [input.quoteCurrency] : [], signal: input.signal,
      });
      return {
        usableFrom: enrolled.windowStartAt,
        points: buckets.map((bucket) => {
          let provisional = false;
          const timestamp = bucket.bucketAt.getTime();
          const series = (key: string, used = true) => {
            const result = lookup.get(key)?.get(timestamp);
            if (used && result?.status === "ready" && result.provisional) provisional = true;
            return result?.status === "ready" ? result.value : null;
          };
          const price = (contract: string, needed: boolean): Price => {
            if (!needed) return { status: "missing", reason: "no-recent-close" };
            const close = series(`close:${contract.toLowerCase()}`);
            return close ? { status: "close", usdPerToken: decimal(close) } : { status: "missing", reason: "no-recent-close" };
          };
          const valuedAssets: AssetInput[] = [];
          for (const asset of assets.values()) {
            if (asset.kind === "morpho-collateral" || asset.kind === "morpho-borrow-shares") continue;
            const quantity = quantityAt(byKey.get(asset.key), timestamp);
            const positive = quantity.status === "ready" && quantity.baseUnits > BigInt(0);
            const direct = directByKey.get(asset.key);
            const vault = vaultByKey.get(asset.key);
            const contract = asset.contractAddress;
            const recognized = contract ? catalog?.get(contract) : undefined;
            const decimalsDisagree = asset.contractAddress !== null && asset.decimals !== undefined && recognized !== undefined && asset.decimals !== recognized.decimals;
            const admission = asset.kind === "native" || direct || vault || contract === HISTORY_WETH_ADDRESS || recognized
              ? "admitted" : "below-market-gate";
            if (asset.kind === "native") {
              valuedAssets.push({ key: asset.key, kind: "native", name: direct?.name ?? "Ethereum",
                symbol: direct?.symbol ?? "ETH", decimals: direct?.decimals ?? 18, cashCurrency: null,
                admission, quantity, price: price(HISTORY_WETH_ADDRESS, positive) });
            } else if (asset.kind === "vault-share") {
              const rate = positive && vault && !decimalsDisagree ? series(`vault-rate:${vault.address.toLowerCase()}`) : null;
              valuedAssets.push({ key: asset.key, kind: "vault-share",
                name: vault?.name ?? direct?.name ?? recognized?.name ?? "Unknown vault",
                symbol: vault?.symbol ?? direct?.symbol ?? recognized?.symbol ?? "UNKNOWN",
                decimals: asset.decimals ?? vault?.decimals ?? direct?.decimals ?? recognized?.decimals ?? 18,
                cashCurrency: null, admission, quantity, rate, underlyingDecimals: 6,
                underlyingPrice: price(PORTFOLIO_USDC_ADDRESS, positive && rate !== null) });
            } else if (asset.kind === "erc20") {
              const erc20Contract = asset.contractAddress;
              const isStock = stockContracts.has(erc20Contract) || erc20Contract.startsWith("0xb20000000000000000000");
              valuedAssets.push({ key: asset.key, kind: "erc20", name: direct?.name ?? recognized?.name ?? "Unknown token",
                symbol: direct?.symbol ?? recognized?.symbol ?? "UNKNOWN", decimals: asset.decimals ?? direct?.decimals ?? recognized?.decimals ?? 18,
                cashCurrency: asset.cashCurrency !== undefined ? asset.cashCurrency : direct?.cashCurrency ?? null, admission, quantity,
                price: decimalsDisagree || isStock ? { status: "missing", reason: "unpriced-basis" } :
                  price(erc20Contract, positive && admission === "admitted") });
            }
          }
          const positions: Position[] = BORROW_MARKETS.map((market) => {
            const [collateral, borrow] = morphoHistoryAssets(market.marketId);
            const collateralQuantity = quantityAt(byKey.get(collateral.key), timestamp);
            const borrowShares = quantityAt(byKey.get(borrow.key), timestamp);
            const collateralContract = market.collateralToken.address.toLowerCase();
            const loanContract = market.loanToken.address.toLowerCase();
            const index = borrowShares.status === "ready" && borrowShares.baseUnits > BigInt(0)
              ? series(`morpho-borrow-index:${market.marketId.toLowerCase()}`, collateralQuantity.status === "ready") : null;
            const canPrice = collateralQuantity.status === "ready" && borrowShares.status === "ready" &&
              (borrowShares.baseUnits === BigInt(0) || index !== null);
            return {
              marketId: market.marketId.toLowerCase() as `0x${string}`,
              collateral: {
                assetKey: collateral.key,
                asset: { key: erc20AssetKey(collateralContract), name: market.collateralToken.name,
                  symbol: market.collateralToken.symbol, decimals: market.collateralToken.decimals, cashCurrency: null },
                quantity: collateralQuantity,
                price: price(collateralContract, canPrice && collateralQuantity.status === "ready" && collateralQuantity.baseUnits > BigInt(0)),
              },
              loan: {
                assetKey: borrow.key,
                asset: { key: erc20AssetKey(loanContract), name: market.loanToken.name,
                  symbol: market.loanToken.symbol, decimals: market.loanToken.decimals, cashCurrency: "USD" },
                borrowShares,
                borrowIndex: index,
                price: price(loanContract, canPrice && borrowShares.status === "ready" && borrowShares.baseUnits > BigInt(0)),
              },
            };
          });
          const needsPointFx = valuedAssets.some((asset) => asset.quantity.status === "ready" &&
            asset.quantity.baseUnits > BigInt(0) && asset.admission === "admitted" &&
            (asset.kind === "vault-share" ? asset.rate !== null && asset.underlyingPrice.status === "close" : asset.price.status === "close")) ||
            positions.some((position) => position.collateral.quantity.status === "ready" &&
              position.loan.borrowShares.status === "ready" &&
              (position.loan.borrowShares.baseUnits === BigInt(0) || position.loan.borrowIndex !== null) &&
              (position.collateral.quantity.baseUnits > BigInt(0) && position.collateral.price.status === "close" ||
                position.loan.borrowShares.baseUnits > BigInt(0) && position.loan.price.status === "close"));
          const fx = input.quoteCurrency === "USD" ? { status: "ready" as const, quotePerUsd: { atoms: "1", scale: 0 } }
            : input.quoteCurrency && needsPointFx ? (() => {
              const rate = series(`fx:USD:${input.quoteCurrency}`);
              return rate ? { status: "ready" as const, quotePerUsd: decimal(rate) } : { status: "missing" as const };
            })() : { status: "missing" as const };
          const unconfiguredPositions = [...assets.values()].flatMap((asset) => {
            if (asset.kind !== "morpho-collateral" && asset.kind !== "morpho-borrow-shares") return [];
            if (BORROW_MARKETS.some((market) => market.marketId.toLowerCase() === asset.marketId)) return [];
            const quantity = quantityAt(byKey.get(asset.key), timestamp);
            const component = asset.kind === "morpho-borrow-shares" ? "borrow" as const : "investments" as const;
            return quantity.status === "unavailable" ? [{ assetKey: asset.key, reason: quantity.reason, component }]
              : quantity.baseUnits === BigInt(0) ? [] : [{ assetKey: asset.key, reason: "unsupported" as const, component }];
          });
          const pointInput = { quoteCurrency: input.quoteCurrency, assets: valuedAssets, morphoPositions: positions, fx, inventory: input.inventory, unpriced: unconfiguredPositions };
          const ethWeightedValue = valueHistoryPoint({ ...pointInput, inventory: "complete", assets: valuedAssets.filter((asset) =>
            asset.kind === "native" || asset.kind === "erc20" && asset.key === erc20AssetKey(HISTORY_WETH_ADDRESS)), morphoPositions: [] }).net.value;
          return { bucketAt: bucket.bucketAt, blockNumber: bucket.blockNumber, provisional,
            value: valueHistoryPoint(pointInput), ethWeightedValue };
        }),
      };
    },
  };
}
