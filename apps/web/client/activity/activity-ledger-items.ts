import { presentPortfolioAssetMark } from "@/client/asset-mark/presentation";
import { getDirectPortfolioAssets, assetKeyForErc20 } from "@/config/portfolio-assets";
import type { RegionId } from "@/config/regions";
import { condensedTransactionHash, transactionExplorerLink } from "@/components/transaction-explorer";
import {
  formatExactPresentationTokenAmount,
  formatPresentationDate,
  formatPresentationTokenAmount,
} from "@/shared/formatting";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActionKind, MoneyActionAmount } from "@/shared/money-actions/types";
import { formatValuationAmount, presentActivityTransferRow } from "./activity-presenter";
import type { ActivityFeedItem } from "./activity-feed";
import type { ActivityLedgerItem, Transaction } from "./activity-ledger";
import type { ActivityTransfer } from "./types";
import { cashoutMoney, presentCashout, type CashoutStage } from "./cash-out-presenter";

const portfolioAssetKeyById: ReadonlyMap<string, string> = new Map(
  getDirectPortfolioAssets().flatMap((asset) => [
    [asset.id, asset.assetKey],
    [asset.assetKey, asset.assetKey],
  ]),
);

type Options = { regionId?: RegionId; timeZone?: string };

function transactionFor(hash: string | undefined): Transaction | undefined {
  if (!hash) return undefined;
  return {
    value: hash,
    display: condensedTransactionHash(hash),
    explorer: transactionExplorerLink(hash) ?? undefined,
  };
}

function transferItem(transfer: ActivityTransfer, options: Options): ActivityLedgerItem {
  const row = presentActivityTransferRow(transfer, options);
  const mark = presentPortfolioAssetMark({
    assetKey: assetKeyForErc20(transfer.tokenAddress),
    name: transfer.tokenSymbol ?? "Unknown token",
    symbol: transfer.tokenSymbol ?? "?",
    imageUrl: transfer.tokenImageUrl,
  });
  const symbol = transfer.tokenSymbol ?? "unknown token";
  const exact = transfer.tokenDecimals === null || transfer.tokenSymbol === null
    ? `${transfer.amountBaseUnits} base units`
    : formatExactPresentationTokenAmount(transfer.amountBaseUnits, transfer.tokenDecimals, transfer.tokenSymbol, { regionId: options.regionId });
  return {
    family: "onchain-transfer",
    id: transfer.id,
    status: "confirmed",
    timestamp: transfer.blockTimestamp,
    updatedAt: transfer.blockTimestamp,
    dateLabel: row.shortDate,
    fullDateLabel: row.fullDate,
    title: row.directionLabel,
    amount: row.value,
    amountContext: row.valueContext ?? undefined,
    detailAmount: `${row.sign}${exact}`,
    direction: transfer.direction === "incoming" ? "in" : transfer.direction === "outgoing" ? "out" : "none",
    mark: { kind: "asset", assetKey: mark.assetKey, symbol: mark.symbol, imageUrl: mark.imageUrl },
    activateLabel: `View ${row.directionLabel.toLowerCase()} ${symbol} transaction details`,
    detail: {
      family: "onchain-transfer",
      counterpartyLabel: transfer.direction === "incoming" ? "From" : "To",
      counterparty: transfer.direction === "incoming" ? transfer.fromAddress : transfer.toAddress,
      network: "Base",
      transaction: transactionFor(transfer.transactionHash),
      facts: transfer.valuation.status === "priced"
        ? [{ label: "Value", value: `${row.sign}${formatValuationAmount(transfer.valuation, options.regionId)}` }]
        : [],
    },
  };
}

function orderedAmounts(amounts: readonly MoneyActionAmount[]): MoneyActionAmount[] {
  return [
    ...amounts.filter((amount) => amount.symbol !== "vault shares"),
    ...amounts.filter((amount) => amount.symbol === "vault shares"),
  ];
}

function kindLabel(kind: ActionKind): string {
  switch (kind) {
    case "send": return "Send";
    case "cash-out": return "Cash out";
    case "cash-out-withdraw": return "Withdraw cash-out";
    case "trade": return "Trade";
    case "savings-deposit": return "Deposit to Save";
    case "savings-withdraw": return "Withdraw from Save";
    case "supply-collateral": return "Add collateral";
    case "borrow": return "Borrow";
    case "repay": return "Repay";
    case "withdraw-collateral": return "Withdraw collateral";
  }
}

function operationTitle(operation: RecentMoneyActionOperation): string {
  const metadata = operation.action.metadata;
  if (operation.action.kind !== "trade" || metadata?.product !== "trade") return operation.action.title;
  const buy = metadata.direction === "buy";
  switch (operation.status) {
    case "confirmed": return buy ? "Bought Bitcoin" : "Sold Bitcoin";
    case "pending": return buy ? "Buying Bitcoin" : "Selling Bitcoin";
    case "failed": return buy ? "Buy Bitcoin failed" : "Sell Bitcoin failed";
    case "unknown": return buy ? "Buy Bitcoin" : "Sell Bitcoin";
  }
}

function amountLabel(operation: RecentMoneyActionOperation, amount: MoneyActionAmount): string {
  if (operation.action.metadata?.product === "trade") return amount.direction === "spend" ? "You pay" : "You receive";
  return amount.maximum ? "Up to" : amount.direction === "spend" ? "You spend" : "You receive";
}

function operationLabel(operation: RecentMoneyActionOperation): string {
  const metadata = operation.action.metadata;
  if (operation.action.kind === "trade" && metadata?.product === "trade") {
    return metadata.direction === "buy" ? "Buy Bitcoin" : "Sell Bitcoin";
  }
  const borrow = metadata?.product === "borrow" ? metadata.operation : null;
  switch (borrow) {
    case "supply-collateral": return "Add collateral";
    case "borrow": return "Borrow";
    case "supply-and-borrow": return "Supply and borrow";
    case "repay": return "Repay";
    case "repay-all": return "Repay all";
    case "withdraw-collateral": return "Withdraw collateral";
    case "close-position": return "Close position";
    default: return kindLabel(operation.action.kind);
  }
}

function secondaryAmountFacts(operation: RecentMoneyActionOperation, options: Options) {
  return orderedAmounts(operation.action.amounts).slice(1).map((amount) => ({
    label: amountLabel(operation, amount),
    value: `${amount.estimated ? "Estimated " : ""}${formatExactPresentationTokenAmount(
      amount.amountBaseUnits, amount.decimals, amount.symbol, { regionId: options.regionId },
    )}`,
  }));
}

function actionItem(operation: RecentMoneyActionOperation, options: Options): ActivityLedgerItem {
  const amounts = orderedAmounts(operation.action.amounts);
  const primary = amounts[0];
  const metadata = operation.action.metadata;
  const facts: { label: string; value: string }[] = [];
  const title = operationTitle(operation);
  if (metadata?.product === "borrow") {
    facts.push({ label: "Market", value: `${metadata.collateralAsset.symbol} / ${metadata.loanAsset.symbol}` });
  } else if (metadata?.product === "cashout") {
    facts.push(
      { label: "Provider", value: metadata.providerName },
      { label: "Payout app", value: metadata.platformLabel },
    );
    if (metadata.operation === "deposit") {
      facts.push(
        { label: "Payout handle", value: metadata.canonicalHandle },
        { label: "Approximate receive", value: `≈ ${metadata.approximateFiatAmount} ${metadata.currency}` },
      );
      if (metadata.etaSeconds !== undefined) {
        facts.push({ label: "Estimated delivery", value: metadata.etaSeconds === null
          ? "Unavailable" : `${Math.ceil(metadata.etaSeconds / 60)} min (historical)` });
      }
    }
  }
  facts.push(...secondaryAmountFacts(operation, options));
  const mark = primary && presentPortfolioAssetMark({
    assetKey: portfolioAssetKeyById.get(primary.assetId.toLowerCase()) ?? primary.assetId,
    name: primary.symbol,
    symbol: primary.symbol,
  });
  return {
    family: "home-action",
    id: operation.action.id,
    status: ({ pending: "waiting-chain", unknown: "ambiguous", confirmed: "confirmed", failed: "failed" } as const)[operation.status],
    timestamp: operation.updatedAt,
    updatedAt: operation.updatedAt,
    dateLabel: formatPresentationDate(operation.updatedAt, { style: "activity-short", ...options }),
    fullDateLabel: formatPresentationDate(operation.updatedAt, { style: "activity-full", ...options }),
    title,
    amount: primary ? `${primary.direction === "spend" ? "−" : "+"}${primary.estimated ? "~" : ""}${formatPresentationTokenAmount(
      primary.amountBaseUnits, primary.decimals, primary.symbol,
      { cashCurrency: primary.symbol === "USDC" ? "USD" : null, regionId: options.regionId },
    )}` : "",
    detailAmount: primary ? `${primary.direction === "spend" ? "−" : "+"}${primary.estimated ? "~" : ""}${formatExactPresentationTokenAmount(
      primary.amountBaseUnits, primary.decimals, primary.symbol, { regionId: options.regionId },
    )}` : undefined,
    direction: primary?.direction === "spend" ? "out" : primary?.direction === "receive" ? "in" : "none",
    mark: operation.action.kind === "borrow" || operation.action.kind === "repay"
      ? { kind: "glyph", glyph: "borrow" }
      : mark ? { kind: "asset", assetKey: mark.assetKey, symbol: mark.symbol, imageUrl: mark.imageUrl } : undefined,
    activateLabel: `View ${title} transaction details`,
    ...(operation.status === "pending" && (operation.submittedAt || operation.transactionHash || operation.userOperationHash) ? { steps: [
      {
        status: "complete" as const,
        title: "Submitted",
        ...(operation.submittedAt && Number.isFinite(Date.parse(operation.submittedAt)) ? {
          time: formatPresentationDate(operation.submittedAt, { style: "activity-full", ...options }),
        } : {}),
      },
      { status: "current" as const, title: "Confirming on Base" },
    ] } : {}),
    detail: {
      family: "home-action",
      operation: operationLabel(operation),
      network: "Base",
      transaction: transactionFor(operation.transactionHash),
      facts,
    },
  };
}

const cashoutStatus: Record<CashoutStage, ActivityLedgerItem["status"]> = {
  waiting: "waiting-provider",
  paying: "waiting-provider",
  returning: "waiting-chain",
  checking: "ambiguous",
  paid: "confirmed",
  returned: "refunded",
  failed: "failed",
};

function cashoutItem(
  operation: RecentMoneyActionOperation,
  withdraw: RecentMoneyActionOperation | undefined,
  options: Options,
): ActivityLedgerItem {
  const base = actionItem(operation, options);
  const view = presentCashout(operation, withdraw, options);
  const money = (atoms: string) => cashoutMoney(atoms, view.decimals, options.regionId);
  const status = cashoutStatus[view.stage];
  const title = `Cash out to ${view.app}`;
  const updatedAt = operation.cashout?.updatedAt && Number.isFinite(Date.parse(operation.cashout.updatedAt))
    ? operation.cashout.updatedAt : operation.updatedAt;
  const facts: { label: string; value: string }[] = [];
  if (view.metadata) facts.push({ label: "Provider", value: view.metadata.providerName });
  facts.push({ label: "Payout app", value: view.app });
  if (view.metadata) {
    facts.push(
      { label: "Payout handle", value: view.metadata.canonicalHandle },
      { label: "Approximate receive", value: `≈ ${view.metadata.approximateFiatAmount} ${view.metadata.currency}` },
    );
  }
  const eta = operation.cashout?.etaSeconds ?? view.metadata?.etaSeconds;
  if ((view.stage === "waiting" || view.stage === "paying") && eta !== null && eta !== undefined) {
    facts.push({ label: "Estimated delivery", value: `About ${Math.ceil(eta / 60)} min` });
  }
  if (BigInt(view.paid) > BigInt(0) && BigInt(view.paid) < BigInt(view.total)) facts.push({ label: "Paid", value: money(view.paid) });
  if (BigInt(view.returned) > BigInt(0)) facts.push({ label: "Returned", value: money(view.returned) });
  facts.push(...secondaryAmountFacts(operation, options));
  return {
    ...base,
    timestamp: updatedAt,
    updatedAt,
    dateLabel: formatPresentationDate(updatedAt, { style: "activity-short", ...options }),
    fullDateLabel: formatPresentationDate(updatedAt, { style: "activity-full", ...options }),
    family: "home-action",
    status,
    title,
    activateLabel: `View ${title} details`,
    ...(view.stage === "returned" ? { statusLabel: "Returned" } : {}),
    ...(view.stage === "returning" ? { ownerSentence: { title: "Returning to your balance" } } : {}),
    steps: view.inProgress && view.stage !== "checking" ? [{ status: "current" as const, title: view.status }] : undefined,
    ...(view.cancellable ? { nextAction: { kind: "cancel-cash-out" as const, label: `Cancel cash-out ${money(view.remaining)}` } } : {}),
    detail: {
      family: "home-action",
      operation: title,
      network: "Base",
      transaction: transactionFor(operation.transactionHash),
      facts,
    },
  };
}

export function presentActivityLedgerItems(items: readonly ActivityFeedItem[], options: Options): ActivityLedgerItem[] {
  return items.map((item) => item.kind === "transfer"
    ? transferItem(item.transfer, options)
    : item.operation.action.kind === "cash-out" &&
      !(item.operation.action.metadata?.product === "cashout" && item.operation.action.metadata.operation === "withdraw")
      ? cashoutItem(item.operation, item.withdraw, options)
      : actionItem(item.operation, options));
}
