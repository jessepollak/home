"use client";

import { useHomeQuery, publicQueryKey } from "@/client/query/query-client";
import { deploymentHeaders } from "@/client/query/deployment-headers";
import { usePresentationRegionId, presentationQuoteForRegion } from "@/client/invest/presentation-quote";
import { presentationRegions } from "@/config/regions";
import { parseMarketPricesResponse } from "@/shared/invest/contracts/market-prices";
import { formatExactPresentationTokenAmount, formatFiatAmount, scaleDecimalByExact } from "@/shared/formatting";
import type { MoneyActionNetworkFee } from "@/shared/money-actions/types";

export function NetworkFeeReview({ fee }: { fee: Extract<MoneyActionNetworkFee, { payment: "usdc" }> }) {
  const regionId = usePresentationRegionId();
  const currency = presentationRegions[regionId].currency.code ?? "USD";
  const fx = useHomeQuery({
    queryKey: publicQueryKey("market-prices", "/api/market-prices"),
    enabled: currency !== "USD",
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/market-prices", { headers: { ...deploymentHeaders(), accept: "application/json" }, cache: "no-store", signal });
      if (!response.ok) throw new Error("Market prices unavailable");
      const parsed = parseMarketPricesResponse(await response.json());
      if (!parsed) throw new Error("Invalid market prices");
      return parsed;
    },
  });
  const quote = presentationQuoteForRegion(regionId, currency === "USD" ? null : fx.data?.fx);
  const usd = scaleDecimalByExact(fee.maxFeeBaseUnits, { atoms: "1", scale: fee.decimals });
  const local = usd && quote.quoteUnitsPerUsd ? scaleDecimalByExact(usd, quote.quoteUnitsPerUsd) : null;
  return <>{`Up to ${formatExactPresentationTokenAmount(fee.maxFeeBaseUnits, fee.decimals, "USDC")} · ≈ ${local === null ? "—" : formatFiatAmount(local, currency, { regionId, fractionDigits: 2 })}`}</>;
}
