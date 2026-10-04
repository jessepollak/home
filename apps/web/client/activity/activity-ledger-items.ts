import { formatUnits } from "viem";
import { cancelledCheckoutCopy } from "@/client/funding/checkout-copy";
import { presentPortfolioAssetMark } from "@/client/asset-mark/presentation";
import { getDirectPortfolioAssets, assetKeyForErc20 } from "@/config/portfolio-assets";
import type { RegionId } from "@/config/regions";
import { condensedTransactionHash, transactionExplorerLink } from "@/components/transaction-explorer";
import {
  formatExactPresentationTokenAmount,
  formatFiatAmount,
  formatPresentationCashAmount,
  formatPresentationDate,
  formatPresentationDateRange,
  formatPresentationTokenAmountParts,
  joinAmountAndSymbol,
} from "@/shared/formatting";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import { ACTIVITY_VALUATION_AMOUNT_SCALE } from "@/shared/activity/valuation";
import { addFractions, exactDecimalToFraction, roundFractionPreservingPositive } from "@/shared/balances/math";
import type { ActionKind, MoneyActionAmount } from "@/shared/money-actions/types";
import { cashConversionPair } from "@/shared/trading/cash-conversion";
import { formatValuationAmount, presentActivityTransferRow } from "./activity-presenter";
import { activityOperationTime, matchesActivityAmountTransfer, type ActivityFeedItem } from "./activity-feed";
import { groupActivityFeed, transferRunTotals } from "./activity-groups";
import type {
  ActivityLedgerAsset, ActivityLedgerEntry, ActivityLedgerFact, ActivityLedgerGroup, ActivityLedgerItem, Transaction,
} from "./activity-ledger";
import type { ActivityTransfer } from "./types";
import type { ActivityOrder, ActivityFundingOrder, ActivityCashoutOrder } from "@/shared/activity/contract-orders";
import { cashoutMoney, cashoutOrderAction, presentCashout, type CashoutStage } from "./cash-out-presenter";
import { cashoutQuoteFromLegacy, formatCashoutArrival } from "@/shared/funding/cash-out-quote";
import { formatCashoutReceive } from "@/shared/funding/cash-out-quote-format";
import type { CashoutMoneyActionMetadata } from "@/shared/money-actions/types";
import { SERVICE_FEE_LABEL, serviceFeeValue } from "@/client/trading/service-fee";
import type { CardPurchase } from "@/shared/cards/transactions-contract";

const directAssets = getDirectPortfolioAssets();
const portfolioAssetKeyById: ReadonlyMap<string, string> = new Map(
  directAssets.flatMap((asset) => [
    [asset.id, asset.assetKey],
    [asset.assetKey, asset.assetKey],
  ]),
);
const portfolioAssetNameByKey: ReadonlyMap<string, string> = new Map(
  directAssets.map((asset) => [asset.assetKey, asset.name]),
);

function detailAsset(mark: { assetKey: string; name: string; symbol: string; imageUrl: string | null }): ActivityLedgerAsset {
  return {
    assetKey: mark.assetKey,
    name: portfolioAssetNameByKey.get(mark.assetKey) ?? mark.name,
    symbol: mark.symbol,
    imageUrl: mark.imageUrl,
    openable: mark.assetKey === "eip155:8453/native" || /^eip155:8453\/erc20:0x[0-9a-f]{40}$/.test(mark.assetKey),
  };
}

type Options = { regionId: RegionId; timeZone?: string; now?: number };

function transactionFor(hash: string | undefined): Transaction | undefined {
  if (!hash) return undefined;
  return {
    value: hash,
    display: condensedTransactionHash(hash),
    explorer: transactionExplorerLink(hash) ?? undefined,
  };
}

function transferAssetMark(transfer: ActivityTransfer) {
  return presentPortfolioAssetMark({
    assetKey: assetKeyForErc20(transfer.tokenAddress),
    name: transfer.tokenSymbol ?? "Unknown token",
    symbol: transfer.tokenSymbol ?? "?",
    imageUrl: transfer.tokenImageUrl,
  });
}

function transferMark(transfer: ActivityTransfer): ActivityLedgerGroup["mark"] {
  const mark = transferAssetMark(transfer);
  return { kind: "asset", assetKey: mark.assetKey, symbol: mark.symbol, imageUrl: mark.imageUrl };
}

function transferAmountParts(transfer: ActivityTransfer, baseUnits: string, options: Options) {
  return transfer.tokenDecimals === null || transfer.tokenSymbol === null
    ? { amount: baseUnits, symbol: "base units" }
    : formatPresentationTokenAmountParts(baseUnits, transfer.tokenDecimals, transfer.tokenSymbol, {
      cashCurrency: transfer.assetId === "usdc" ? "USD" : null, regionId: options.regionId,
    });
}

function transferItem(transfer: ActivityTransfer, options: Options): ActivityLedgerItem {
  const row = presentActivityTransferRow(transfer, options);
  const symbol = transfer.tokenSymbol ?? "unknown token";
  const parts = transferAmountParts(transfer, transfer.amountBaseUnits, options);
  const mark = transferAssetMark(transfer);
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
    detailAmount: joinAmountAndSymbol(`${row.sign}${parts.amount}`, parts.symbol),
    detailAmountParts: { amount: `${row.sign}${parts.amount}`, symbol: parts.symbol },
    detailValue: transfer.valuation.status === "priced"
      ? `${row.sign}${formatValuationAmount(transfer.valuation, options.regionId)}` : "Unknown",
    detailAsset: detailAsset(mark),
    direction: transfer.direction === "incoming" ? "in" : transfer.direction === "outgoing" ? "out" : "none",
    mark: { kind: "asset", assetKey: mark.assetKey, symbol: mark.symbol, imageUrl: mark.imageUrl },
    activateLabel: `View ${row.directionLabel.toLowerCase()} ${symbol} transaction details`,
    detail: {
      family: "onchain-transfer",
      counterpartyLabel: transfer.direction === "incoming" ? "From" : "To",
      counterparty: transfer.direction === "incoming" ? transfer.fromAddress : transfer.toAddress,
      network: "Base",
      transaction: transactionFor(transfer.transactionHash),
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
    case "card-allowance": return "Card spending limit";
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
  if (operation.action.kind === "card-allowance" && metadata?.product === "card") {
    if (operation.status === "confirmed") return metadata.operation === "set-allowance" ? "Card spending limit set" : "Card spending permission removed";
    if (operation.status === "pending") return metadata.operation === "set-allowance" ? "Setting card spending limit" : "Removing card spending permission";
    return metadata.operation === "set-allowance" ? "Set card spending limit" : "Remove card spending permission";
  }
  if (operation.action.kind !== "trade" || metadata?.product !== "trade") return operation.action.title;
  const conversion = cashConversionPair(metadata);
  if (conversion) {
    const pair = `${conversion.from.code} to ${conversion.to.code}`;
    switch (operation.status) {
      case "confirmed": return `Converted ${pair}`;
      case "pending": return `Converting ${pair}`;
      case "failed": return `Convert ${pair} failed`;
      case "unknown": return `Convert ${pair}`;
    }
  }
  const buy = metadata.direction === "buy";
  switch (operation.status) {
    case "confirmed": return `${buy ? "Bought" : "Sold"} ${metadata.assetName}`;
    case "pending": return `${buy ? "Buying" : "Selling"} ${metadata.assetName}`;
    case "failed": return `${buy ? "Buy" : "Sell"} ${metadata.assetName} failed`;
    case "unknown": return `${buy ? "Buy" : "Sell"} ${metadata.assetName}`;
  }
}

function amountLabel(operation: RecentMoneyActionOperation, amount: MoneyActionAmount): string {
  if (operation.action.metadata?.product === "trade") return amount.direction === "spend" ? "You pay" : "You receive";
  return amount.maximum ? "Up to" : amount.direction === "spend" ? "You spend" : "You receive";
}

function operationLabel(operation: RecentMoneyActionOperation): string {
  const metadata = operation.action.metadata;
  if (operation.action.kind === "trade" && metadata?.product === "trade") {
    const conversion = cashConversionPair(metadata);
    if (conversion) return `Convert ${conversion.from.code} to ${conversion.to.code}`;
    return `${metadata.direction === "buy" ? "Buy" : "Sell"} ${metadata.assetName}`;
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

function actionAmountParts(amount: MoneyActionAmount, options: Options) {
  return amount.maximum
    ? { amount: formatExactPresentationTokenAmount(amount.amountBaseUnits, amount.decimals, "", { regionId: options.regionId }), symbol: amount.symbol }
    : formatPresentationTokenAmountParts(amount.amountBaseUnits, amount.decimals, amount.symbol, { regionId: options.regionId });
}

function secondaryAmountFacts(operation: RecentMoneyActionOperation, options: Options) {
  return orderedAmounts(operation.action.amounts).slice(1).map((amount) => {
    const parts = actionAmountParts(amount, options);
    return {
      label: amountLabel(operation, amount),
      value: `${amount.estimated ? "Estimated " : ""}${joinAmountAndSymbol(parts.amount, parts.symbol)}`,
    };
  });
}

function actionDetailValue(
  amount: MoneyActionAmount,
  matched: readonly ActivityTransfer[],
  confirmed: boolean,
  regionId: RegionId,
): string | undefined {
  if (matched.length === 0) return confirmed ? "Unknown" : undefined;
  const priced = matched.flatMap((transfer) => transfer.valuation.status === "priced" ? [transfer.valuation] : []);
  const first = priced[0];
  if (!first || priced.length !== matched.length || priced.some((valuation) => valuation.currency !== first.currency) ||
    matched.reduce((sum, transfer) => sum + BigInt(transfer.amountBaseUnits), BigInt(0)) !== BigInt(amount.amountBaseUnits)) {
    return "Unknown";
  }
  const summed = roundFractionPreservingPositive(
    addFractions(priced.map((valuation) => exactDecimalToFraction(valuation.amount))),
    ACTIVITY_VALUATION_AMOUNT_SCALE,
  );
  return `${amount.direction === "spend" ? "−" : "+"}${formatValuationAmount({ ...first, amount: summed }, regionId)}`;
}

function actionItem(operation: RecentMoneyActionOperation, transfers: readonly ActivityTransfer[], options: Options): ActivityLedgerItem {
  const amounts = orderedAmounts(operation.action.amounts);
  const primary = amounts[0];
  const primaryParts = primary ? actionAmountParts(primary, options) : undefined;
  const primaryPrefix = primary ? `${primary.direction === "spend" ? "−" : "+"}${primary.estimated ? "~" : ""}` : "";
  const metadata = operation.action.metadata;
  const facts: ActivityLedgerFact[] = [];
  const title = operationTitle(operation);
  if (metadata?.product === "card") {
    facts.push({ label: "Card program spender", value: metadata.spender, kind: "address" });
    facts.push({ label: "Spending limit", value: metadata.operation === "revoke-allowance" ? "Removed" : `${formatUnits(BigInt(metadata.allowanceBaseUnits), 6)} USDC` });
  } else if (metadata?.product === "trade") {
    const traded = metadata.direction === "buy" ? metadata.toAsset : metadata.fromAsset;
    facts.push({ label: `${traded.symbol} contract`, value: traded.address, kind: "address" });
  } else if (metadata?.product === "borrow") {
    facts.push({ label: "Market", value: `${metadata.collateralAsset.symbol} / ${metadata.loanAsset.symbol}` });
  } else if (metadata?.product === "cashout") {
    facts.push(
      { label: "Provider", value: metadata.providerName },
      { label: "Payout app", value: metadata.platformLabel },
    );
    if (metadata.operation === "deposit") {
      const quote = reviewedQuote(metadata);
      facts.push(
        { label: "Payout handle", value: metadata.canonicalHandle },
        { label: "You receive", value: formatCashoutReceive(quote.receive, metadata.platformLabel) },
        { label: "Arrives", value: formatCashoutArrival(quote.arrival) },
      );
    }
  }
  facts.push(...secondaryAmountFacts(operation, options));
  if (metadata?.product === "trade" && metadata.operatorFee) {
    facts.push({ label: SERVICE_FEE_LABEL, value: serviceFeeValue(metadata.operatorFee, options.regionId) });
  }
  const mark = primary && presentPortfolioAssetMark({
    assetKey: portfolioAssetKeyById.get(primary.assetId.toLowerCase()) ?? primary.assetId,
    name: primary.symbol,
    symbol: primary.symbol,
  });
  const singleAsset = primary && mark && metadata?.product !== "trade" &&
    !(metadata?.product === "borrow" && metadata.operation === "supply-and-borrow") &&
    new Set(amounts.filter((amount) => amount.symbol !== "vault shares").map((amount) => amount.assetId.toLowerCase())).size === 1;
  const matched = singleAsset && mark.assetKey.startsWith("eip155:8453/erc20:")
    ? transfers.filter((transfer) => matchesActivityAmountTransfer(primary, transfer)) : [];
  return {
    family: "home-action",
    id: operation.action.id,
    status: ({ pending: "waiting-chain", unknown: "ambiguous", confirmed: "confirmed", failed: "failed" } as const)[operation.status],
    timestamp: operation.updatedAt,
    updatedAt: operation.updatedAt,
    dateLabel: formatPresentationDate(operation.updatedAt, { style: "activity-short", ...options }),
    fullDateLabel: formatPresentationDate(operation.updatedAt, { style: "activity-full", ...options }),
    title,
    amount: primary && primaryParts ? `${primaryPrefix}${primary.maximum
      ? joinAmountAndSymbol(primaryParts.amount, primaryParts.symbol)
      : primary.symbol === "USDC"
        ? formatPresentationCashAmount(primary.amountBaseUnits, primary.decimals, "USD", { regionId: options.regionId })
        : joinAmountAndSymbol(primaryParts.amount, primaryParts.symbol)}` : "",
    detailAmount: primaryParts ? joinAmountAndSymbol(`${primaryPrefix}${primaryParts.amount}`, primaryParts.symbol) : undefined,
    detailAmountParts: primaryParts ? { amount: `${primaryPrefix}${primaryParts.amount}`, symbol: primaryParts.symbol } : undefined,
    detailAsset: singleAsset ? detailAsset(mark) : undefined,
    detailValue: singleAsset
      ? actionDetailValue(primary, matched, operation.status === "confirmed", options.regionId)
      : undefined,
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

function reviewedQuote(metadata: CashoutMoneyActionMetadata) {
  return metadata.quote ?? cashoutQuoteFromLegacy(metadata);
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
  const base = actionItem(operation, [], options);
  const view = presentCashout(operation, withdraw, options);
  const prospective = view.stage === "waiting" || view.stage === "paying";
  const money = (atoms: string) => cashoutMoney(atoms, view.decimals, options.regionId);
  const status = cashoutStatus[view.stage];
  const title = `Cash out to ${view.app}`;
  const updatedAt = activityOperationTime(operation);
  const facts: { label: string; value: string }[] = [];
  if (view.metadata) facts.push({ label: "Provider", value: view.metadata.providerName });
  facts.push({ label: "Payout app", value: view.app });
  if (view.metadata) {
    facts.push(
      { label: "Payout handle", value: view.metadata.canonicalHandle },
      { label: prospective ? "You receive" : "Quoted receive", value: formatCashoutReceive(reviewedQuote(view.metadata).receive, view.metadata.platformLabel) },
    );
  }
  if (prospective) {
    const arrival = view.metadata ? reviewedQuote(view.metadata).arrival
      : cashoutQuoteFromLegacy({ approximateFiatAmount: "0", currency: "USD", etaSeconds: operation.cashout?.etaSeconds }).arrival;
    facts.push({ label: "Arrives", value: formatCashoutArrival(arrival) });
  }
  if (BigInt(view.paid) > BigInt(0) && BigInt(view.paid) < BigInt(view.total)) facts.push({ label: "Paid", value: money(view.paid) });
  if (BigInt(view.returned) > BigInt(0)) facts.push({ label: "Returned", value: money(view.returned) });
  facts.push(...secondaryAmountFacts(operation, options));
  return {
    ...base,
    detailValue: undefined,
    detailAsset: undefined,
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

function fundingItem(order: ActivityFundingOrder, options: Options): ActivityLedgerItem {
  const movedAt = order.movedAt ?? order.updatedAt;
  const cancelledByOwner = order.stage === "cancelled" && order.abandonReason === "owner";
  const timedOut = order.stage === "expired" && order.abandonReason === "timed-out";
  const full = (value: string) => formatPresentationDate(value, { style: "activity-full", ...options });
  const created = { status: "complete" as const, title: "Order created", time: full(order.createdAt) };
  const received = { status: "complete" as const, title: "Payment received" };
  const steps = order.status !== "ambiguous" && ["waiting-customer", "waiting-provider", "waiting-chain", "waiting-home"].includes(order.status)
    ? order.stage === "awaiting-payment" ? [created, { status: "current" as const, title: "Waiting for your payment", ...(order.expiresAt ? { time: `Pay by ${full(order.expiresAt)}` } : {}) }]
      : order.stage === "provider-processing" ? [created, received, { status: "current" as const, title: `Waiting on ${order.providerName}` }]
        : order.stage === "arriving" ? [created, received, { status: "complete" as const, title: `Sent by ${order.providerName}` }, { status: "current" as const, title: "Arriving on Base" }]
          : undefined
    : undefined;
  const nextAction: ActivityLedgerItem["nextAction"] = order.status === "waiting-customer" && order.resumable && order.region === options.regionId
    ? order.instruction === "redirect" || order.instruction === "embed"
      ? { kind: "resume", label: `Continue with ${order.providerName}` }
      : { kind: "complete-payment", label: "Complete payment" }
    : order.status === "ambiguous" && order.stage === "unconfirmed" && order.clearableAt !== null &&
        Date.parse(order.clearableAt) <= (options.now ?? Date.now())
      ? { kind: "clear-order", label: "Clear order" } : undefined;
  const fiat = `${order.fiatAmount} ${order.fiatCurrency}`;
  const parts = order.tokenAmountAtomic === null ? { amount: order.fiatAmount, symbol: order.fiatCurrency }
    : formatPresentationTokenAmountParts(order.tokenAmountAtomic, order.asset.decimals, order.asset.symbol, { regionId: options.regionId });
  const amount = order.tokenAmountAtomic === null ? fiat : order.asset.symbol === "USDC"
    ? formatPresentationCashAmount(order.tokenAmountAtomic, order.asset.decimals, "USD", { regionId: options.regionId })
    : joinAmountAndSymbol(parts.amount, parts.symbol);
  return {
    family: "funding-order", id: order.id, status: order.status, timestamp: movedAt, updatedAt: movedAt,
    dateLabel: formatPresentationDate(movedAt, { style: "activity-short", ...options }), fullDateLabel: full(movedAt),
    title: "Add money", amount: `+${amount}`, detailAmount: joinAmountAndSymbol(`+${parts.amount}`, parts.symbol),
    detailAmountParts: { amount: `+${parts.amount}`, symbol: parts.symbol },
    direction: "in", mark: { kind: "glyph", glyph: "cash" }, activateLabel: "View Add money details",
    ...(order.stage === "cleared" ? { statusLabel: "Cleared" } : order.stage === "cancelled" ? { statusLabel: "Cancelled" } : timedOut ? { statusLabel: "Timed out" } : {}),
    ...(order.status === "waiting-customer" && order.stage === "awaiting-payment"
      ? { secondaryAction: { kind: "cancel-order" as const, label: "Cancel deposit" } } : {}),
    ...(cancelledByOwner || timedOut ? { ownerSentence: {
      title: cancelledByOwner ? "Deposit cancelled" : "Checkout timed out",
      description: cancelledByOwner ? cancelledCheckoutCopy(order.providerName)
        : "If you already paid, the money will still show up here when it arrives.",
    } } : {}),
    ...(order.stage === "unconfirmed" && !order.clearableAt ? { ownerSentence: {
      title: `Checking with ${order.providerName}`,
      description: `Home will update this when ${order.providerName} confirms it.`,
    } } : {}),
    ...(steps ? { steps } : {}), ...(nextAction ? { nextAction } : {}),
    ...(order.status === "ambiguous" && order.stage === "unconfirmed" && order.clearableAt && Date.parse(order.clearableAt) > (options.now ?? Date.now())
      ? { ownerSentence: { title: "We can't confirm this yet", description: `Don't try again. You can clear it after ${full(order.clearableAt)}.` } } : {}),
    detail: { family: "funding-order", provider: order.providerName, paymentMethod: order.paymentMethodLabel, orderId: order.id },
  };
}

function cashoutOrderItem(order: ActivityCashoutOrder, withdraw: RecentMoneyActionOperation | undefined, reviewed: RecentMoneyActionOperation | undefined, options: Options): ActivityLedgerItem {
  const action = cashoutOrderAction(order, withdraw);
  const returning = withdraw !== undefined && withdraw.status !== "failed" &&
    ["waiting-provider", "waiting-chain", "reversed", "ambiguous"].includes(order.status);
  const prospective = order.status === "waiting-provider" && !returning &&
    ["submitted", "awaiting-buyer", "matched", "delivering"].includes(order.state);
  const money = (atoms: string) => cashoutMoney(atoms, order.decimals, options.regionId);
  const title = `Cash out to ${order.platformLabel}`;
  const step = returning || order.status === "waiting-chain" ? "Returning to your balance"
    : order.status === "waiting-provider"
      ? ["submitted", "awaiting-buyer"].includes(order.state) ? "Waiting for a buyer"
        : ["matched", "delivering"].includes(order.state) ? "Buyer paying you" : null
      : null;
  const facts: { label: string; value: string }[] = [];
  const metadata = reviewed?.action.metadata;
  if (reviewed?.action.kind === "cash-out" && metadata?.product === "cashout" && metadata.operation === "deposit") {
    const quote = reviewedQuote(metadata);
    facts.push({ label: prospective ? "You receive" : "Quoted receive", value: formatCashoutReceive(quote.receive, metadata.platformLabel) });
    if (prospective) {
      facts.push({ label: "Arrives", value: formatCashoutArrival(quote.arrival) });
    }
  }
  if (BigInt(order.filledAtomic) > BigInt(0) && BigInt(order.filledAtomic) < BigInt(order.amountAtomic)) {
    facts.push({ label: "Paid", value: money(order.filledAtomic) });
  }
  if (BigInt(order.returnedAtomic) > BigInt(0)) facts.push({ label: "Returned", value: money(order.returnedAtomic) });
  return {
    family: "cash-out-order", id: order.id, status: returning ? "waiting-chain" : order.status, timestamp: order.updatedAt, updatedAt: order.updatedAt,
    dateLabel: formatPresentationDate(order.updatedAt, { style: "activity-short", ...options }),
    fullDateLabel: formatPresentationDate(order.updatedAt, { style: "activity-full", ...options }),
    title, amount: `−${money(order.amountAtomic)}`, detailAmount: `−${money(order.amountAtomic)}`,
    direction: "out", mark: { kind: "glyph", glyph: "cash" }, activateLabel: `View ${title} details`,
    ...(order.status === "refunded" ? { statusLabel: "Returned" } : {}),
    ...(step ? { steps: [{ status: "current" as const, title: step }] } : {}),
    ...(returning ? { ownerSentence: { title: "Returning to your balance" } }
      : order.status === "reversed" ? {
        ownerSentence: { title: `${money(order.remainingAtomic)} came back`, description: "Withdraw it to your balance." },
      } : {}),
    ...(action === "withdraw-returned-funds" ? { nextAction: { kind: action, label: `Withdraw ${money(order.remainingAtomic)}` } }
      : action === "cancel-cash-out" ? { nextAction: { kind: action, label: `Cancel cash-out ${money(order.remainingAtomic)}` } } : {}),
    detail: {
      family: "cash-out-order", provider: order.providerName, payoutMethod: order.platformLabel, orderId: order.orderId ?? order.id,
      ...(facts.length > 0 ? { facts } : {}),
    },
  };
}

function orderItem(order: ActivityOrder, withdraw: RecentMoneyActionOperation | undefined, reviewed: RecentMoneyActionOperation | undefined, options: Options): ActivityLedgerItem {
  return order.kind === "funding" ? fundingItem(order, options) : cashoutOrderItem(order, withdraw, reviewed, options);
}

export function presentActivityLedgerEntries(
  pairs: readonly { item: ActivityLedgerItem; source: ActivityFeedItem }[],
  options: Options,
  previous: readonly ActivityLedgerEntry[] = [],
): ActivityLedgerEntry[] {
  const previousGroups = new Map(previous.filter((entry): entry is ActivityLedgerGroup => "kind" in entry && entry.kind === "group")
    .map((entry) => [entry.children[0]?.id, entry]));
  return groupActivityFeed(pairs, (pair) => pair.source).map((group) => {
    if (group.kind === "single") return group.entry.item;
    const reused = previousGroups.get(group.entries[0]?.item.id);
    if (reused && reused.children.length === group.entries.length &&
      group.entries.every(({ item }, index) => reused.children[index] === item)) return reused;
    const transfers = group.entries.map(({ source }) => {
      if (source.kind !== "transfer") throw new TypeError("Transfer run contains a non-transfer entry");
      return source.transfer;
    });
    const newest = transfers[0]!;
    const oldest = transfers[transfers.length - 1]!;
    const title = "Received";
    const countLabel = `${transfers.length} transfers`;
    const totals = transferRunTotals(transfers);
    const parts = transferAmountParts(newest, totals.baseUnits, options);
    const quantity = joinAmountAndSymbol(`+${parts.amount}`, parts.symbol);
    return {
      kind: "group",
      id: `transfer-run:${newest.id}`,
      title,
      countLabel,
      count: transfers.length,
      newestTimestamp: newest.blockTimestamp,
      oldestTimestamp: oldest.blockTimestamp,
      rangeLabel: formatPresentationDateRange(oldest.blockTimestamp, newest.blockTimestamp, { style: "activity-date", ...options }),
      fullRangeLabel: formatPresentationDateRange(oldest.blockTimestamp, newest.blockTimestamp, { style: "activity-full", ...options }),
      amount: totals.value.status === "priced"
        ? `+${formatFiatAmount(BigInt(totals.value.amount.atoms), totals.value.amount.scale,
          totals.value.currency, { fractionDigits: 2, markTiny: true, regionId: options.regionId })}`
        : quantity,
      ...(totals.value.status === "priced" ? { amountContext: quantity } : {}),
      direction: "in",
      mark: transferMark(newest),
      toggleLabel: `${transfers.length} Received ${newest.tokenSymbol ?? "unknown token"} transfers`,
      children: group.entries.map(({ item }) => item),
    } satisfies ActivityLedgerGroup;
  });
}

function cardItem(purchase: CardPurchase, options: Options): ActivityLedgerItem {
  const amount = formatFiatAmount(BigInt(purchase.amountMinor), 2, purchase.currency, { regionId: options.regionId });
  const status = ({ pending: "waiting-provider", declined: "failed", completed: "confirmed",
    reversed: "reversed", refunded: "refunded" } as const)[purchase.status];
  const statusLabel = purchase.status === "declined" && purchase.declineReasonCode
    ? `Declined · ${purchase.declineReasonCode.replaceAll("_", " ")}`
    : purchase.status[0]!.toUpperCase() + purchase.status.slice(1);
  const unchanged = purchase.status === "declined" || purchase.status === "reversed";
  const prefix = purchase.status === "refunded" ? "+" : unchanged ? "" : "−";
  return {
    family: "card", id: purchase.id, status, statusLabel, timestamp: purchase.createdAt, updatedAt: purchase.updatedAt,
    dateLabel: formatPresentationDate(purchase.createdAt, { style: "activity-short", ...options }),
    fullDateLabel: formatPresentationDate(purchase.createdAt, { style: "activity-full", ...options }),
    title: purchase.merchantName, amount: `${prefix}${amount}`, detailAmount: `${prefix}${amount}`,
    direction: purchase.status === "refunded" ? "in" : unchanged ? "none" : "out",
    ...(unchanged ? { ownerSentence: { title: purchase.status === "declined" ? "Declined" : "Reversed", description: "Your balance didn't change." } } : {}),
    mark: { kind: "glyph", glyph: "card" }, activateLabel: `View ${purchase.merchantName} card purchase details`,
    detail: { family: "card", merchant: purchase.merchantName, cardLabel: "Card" },
  };
}

export function presentActivityLedgerItems(items: readonly ActivityFeedItem[], options: Options): ActivityLedgerItem[] {
  return items.map((item) => item.kind === "transfer"
    ? transferItem(item.transfer, options)
    : item.kind === "card" ? cardItem(item.purchase, options)
    : item.kind === "order" ? orderItem(item.order, item.withdraw, item.reviewed, options)
    : item.operation.action.kind === "cash-out" &&
      !(item.operation.action.metadata?.product === "cashout" && item.operation.action.metadata.operation === "withdraw")
      ? cashoutItem(item.operation, item.withdraw, options)
      : actionItem(item.operation, item.transfers, options));
}
