import { actionResultObservation } from "./action-result-observation";
import { actions } from "./actions";
import { activity } from "./activity";
import { activityOrders } from "./activity-orders";
import { activityWindow } from "./activity-window";
import { balances } from "./balances";
import { balancesAction } from "./balances-action";
import { basename } from "./basename";
import { borrow } from "./borrow";
import { borrowMarket } from "./borrow-market";
import { cards } from "./cards";
import { cardSpending } from "./card-spending";
import { fundingOpenOrder } from "./funding-open-order";
import { fundingOpenOrderByProvider } from "./funding-open-order-by-provider";
import { fundingOrder } from "./funding-order";
import { fundingOrderIsolated } from "./funding-order-isolated";
import { fundingProviderCustomers } from "./funding-provider-customers";
import { fundingProviders } from "./funding-providers";
import { investAsset } from "./invest-asset";
import { investDiscover } from "./invest-discover";
import { investSearch } from "./invest-search";
import { inviteLink } from "./invite-link";
import { marketPrices } from "./market-prices";
import { marketStats } from "./market-stats";
import { networkFeePolicy } from "./network-fee-policy";
import { priceHistory } from "./price-history";
import { savingsVaults } from "./savings-vaults";
import { stockTradeEligibility } from "./stock-trade-eligibility";
import { supportConversation } from "./support-conversation";
import { supportSummary } from "./support-summary";
import { tradeAvailability } from "./trade-availability";
import { transfersRecentRecipients } from "./transfers-recent-recipients";
import { transfersRecipientName } from "./transfers-recipient-name";

export const queryScopes = {
  "action-result-observation": actionResultObservation,
  actions,
  activity,
  "activity-orders": activityOrders,
  "activity-window": activityWindow,
  balances,
  "balances-action": balancesAction,
  basename,
  borrow,
  "borrow-market": borrowMarket,
  cards,
  "card-spending": cardSpending,
  "funding-open-order": fundingOpenOrder,
  "funding-open-order-by-provider": fundingOpenOrderByProvider,
  "funding-order": fundingOrder,
  "funding-order-isolated": fundingOrderIsolated,
  "funding-provider-customers": fundingProviderCustomers,
  "funding-providers": fundingProviders,
  "invest-asset": investAsset,
  "invest-discover": investDiscover,
  "invest-search": investSearch,
  "invite-link": inviteLink,
  "market-prices": marketPrices,
  "market-stats": marketStats,
  "network-fee-policy": networkFeePolicy,
  "price-history": priceHistory,
  "savings-vaults": savingsVaults,
  "stock-trade-eligibility": stockTradeEligibility,
  "support-conversation": supportConversation,
  "support-summary": supportSummary,
  "trade-availability": tradeAvailability,
  "transfers-recent-recipients": transfersRecentRecipients,
  "transfers-recipient-name": transfersRecipientName,
} as const;
