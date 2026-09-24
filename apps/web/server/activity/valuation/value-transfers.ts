import "server-only";

import type { FiatCurrencyCode } from "@/config/regions";
import type { ActivityTransfer } from "@/shared/activity/types";
import {
  activityPegCurrency,
  activityValuationDate,
  computeActivityValuationAmount,
  unpricedActivityValuation,
  type ActivityTransferValuation,
  type ActivityValuationFx,
} from "@/shared/activity/valuation";
import {
  createCodexHistoricalCloseReader,
  historicalCloseKey,
  type HistoricalCloseReader,
  type HistoricalCloseRequest,
  type HistoricalCloseResult,
} from "./codex-closes";
import {
  createCoinbaseDailyFxReader,
  dailyFxKey,
  type DailyFxReader,
  type DailyFxRequest,
  type DailyFxResult,
} from "./coinbase-daily-fx";

export type UnvaluedActivityTransfer = Omit<ActivityTransfer, "valuation">;

export type ActivityTransferValuer = (
  transfers: readonly UnvaluedActivityTransfer[],
  currency: FiatCurrencyCode,
  signal?: AbortSignal,
) => Promise<ActivityTransferValuation[]>;

export function createActivityTransferValuer(dependencies: {
  readCloses: HistoricalCloseReader;
  readFx: DailyFxReader;
}): ActivityTransferValuer {
  return async function valueTransfers(transfers, currency, signal) {
    const closeRequests: HistoricalCloseRequest[] = [];
    const fxRequests: DailyFxRequest[] = [];
    for (const transfer of transfers) {
      if (transfer.tokenDecimals === null) continue;
      const date = activityValuationDate(transfer.blockTimestamp);
      const peg = activityPegCurrency(transfer.tokenAddress);
      if (peg) {
        if (peg !== currency) fxRequests.push({ base: peg, quote: currency, date });
        continue;
      }
      closeRequests.push({
        contract: transfer.tokenAddress,
        timestampSeconds: timestampSeconds(transfer.blockTimestamp),
      });
      if (currency !== "USD") fxRequests.push({ base: "USD", quote: currency, date });
    }

    const [closes, rates] = await Promise.all([
      closeRequests.length > 0
        ? dependencies.readCloses(closeRequests, signal).catch(() => new Map<string, HistoricalCloseResult>())
        : new Map<string, HistoricalCloseResult>(),
      fxRequests.length > 0
        ? dependencies.readFx(fxRequests, signal).catch(() => new Map<string, DailyFxResult>())
        : new Map<string, DailyFxResult>(),
    ]);

    return transfers.map((transfer) => valueTransfer(transfer, currency, closes, rates));
  };
}

export function valueTransfersWithoutQuotes(
  transfers: readonly UnvaluedActivityTransfer[],
  currency: FiatCurrencyCode,
): ActivityTransferValuation[] {
  return transfers.map((transfer) =>
    valueTransfer(transfer, currency, new Map(), new Map(), "quote-unavailable"),
  );
}

function valueTransfer(
  transfer: UnvaluedActivityTransfer,
  currency: FiatCurrencyCode,
  closes: ReadonlyMap<string, HistoricalCloseResult>,
  rates: ReadonlyMap<string, DailyFxResult>,
  missingFxReason: "fx-unavailable" | "quote-unavailable" = "fx-unavailable",
): ActivityTransferValuation {
  if (transfer.tokenDecimals === null || transfer.tokenSymbol === null) {
    return unpricedActivityValuation(currency, "unknown-token");
  }
  const date = activityValuationDate(transfer.blockTimestamp);
  const peg = activityPegCurrency(transfer.tokenAddress);
  if (peg) {
    const fx = peg === currency ? null : readFx(rates, { base: peg, quote: currency, date });
    if (fx === undefined) return unpricedActivityValuation(currency, missingFxReason);
    return {
      status: "priced",
      currency,
      amount: computeActivityValuationAmount({
        amountBaseUnits: transfer.amountBaseUnits,
        tokenDecimals: transfer.tokenDecimals,
        unitPrice: null,
        fxRate: fx?.rate ?? null,
      }),
      method: "peg",
      peg,
      close: null,
      fx,
    };
  }

  const close = closes.get(historicalCloseKey({
    contract: transfer.tokenAddress,
    timestampSeconds: timestampSeconds(transfer.blockTimestamp),
  }));
  if (!close || close.status === "unavailable") {
    return unpricedActivityValuation(currency, "quote-unavailable");
  }
  if (close.status === "none") {
    return unpricedActivityValuation(currency, "no-recent-close");
  }
  const fx = currency === "USD" ? null : readFx(rates, { base: "USD", quote: currency, date });
  if (fx === undefined) return unpricedActivityValuation(currency, "fx-unavailable");
  return {
    status: "priced",
    currency,
    amount: computeActivityValuationAmount({
      amountBaseUnits: transfer.amountBaseUnits,
      tokenDecimals: transfer.tokenDecimals,
      unitPrice: close.close.priceUsd,
      fxRate: fx?.rate ?? null,
    }),
    method: "historical-close",
    peg: null,
    close: close.close,
    fx,
  };
}

function readFx(
  rates: ReadonlyMap<string, DailyFxResult>,
  request: DailyFxRequest,
): ActivityValuationFx | undefined {
  const result = rates.get(dailyFxKey(request));
  if (!result) return undefined;
  return {
    provider: "Coinbase",
    base: request.base,
    quote: request.quote,
    date: request.date,
    rate: result.rate,
    provisional: result.provisional,
  };
}

function timestampSeconds(blockTimestamp: string): number {
  return Math.floor(new Date(blockTimestamp).getTime() / 1_000);
}

let sharedValuer: ActivityTransferValuer | null = null;
let sharedApiKey: string | undefined;

export function getActivityTransferValuer(): ActivityTransferValuer {
  const apiKey = process.env.CODEX_API_KEY;
  if (!sharedValuer || sharedApiKey !== apiKey) {
    sharedApiKey = apiKey;
    sharedValuer = createActivityTransferValuer({
      readCloses: createCodexHistoricalCloseReader({ apiKey }),
      readFx: createCoinbaseDailyFxReader(),
    });
  }
  return sharedValuer;
}
