import { regionIds } from "@/config/regions";
import { ACTIVITY_CONTRACT_VERSION, isVerifiedActivitySession, parseActivityPage } from "@/shared/activity/contract";
import { ACTIVITY_BASE_CHAIN_ID } from "@/shared/activity/types";
import { mergeActivityPages } from "@/shared/activity/pages";
import { isActivityValuationCurrency } from "@/shared/activity/valuation";
import { BALANCES_CHAIN_ID } from "@/shared/balances/types";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import { parseBorrowOverview, parseSnapshot } from "@/shared/borrowing/contract";
import { parseAddress } from "@/shared/chain/hex";
import { isFundingOrderSummary } from "@/shared/funding/contracts/order";
import { readFundingProviderCustomers } from "@/shared/funding/contracts/provider-customers";
import { readProviderBindings } from "@/shared/funding/contracts/providers";
import { isRecord } from "@/shared/guards";
import { parseStockTradeEligibilityResponse } from "@/shared/trading/contract-stock-eligibility";
import { parseTradeAvailabilityResponse } from "@/shared/trading/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RestoredQueryEntry, TrustedRestoredData } from "./scopes/policy";

type RestoredOwner = {
  subject: string;
  address: `0x${string}`;
  chainId: number;
  accountProvider: string | null;
};

function restoredOwner(ownerKey: string): RestoredOwner | null {
  const parts = ownerKey.split("\u0000");
  if (parts.length < 3 || parts.length > 4) return null;
  const [subject, rawAddress, rawChainId, provider] = parts;
  const address = parseAddress(rawAddress);
  const chainId = Number(rawChainId);
  if (!subject || !address || !rawChainId || !Number.isSafeInteger(chainId)) return null;
  return { subject, address, chainId, accountProvider: provider || null };
}

function activitySession(owner: RestoredOwner): VerifiedAccountSession | null {
  if (owner.accountProvider !== "cdp-embedded" && owner.accountProvider !== "base-account") return null;
  if (owner.chainId !== ACTIVITY_BASE_CHAIN_ID) return null;
  const session: VerifiedAccountSession = {
    user: { subject: owner.subject },
    smartAccount: { address: owner.address, chainId: owner.chainId },
    accountProvider: owner.accountProvider,
  };
  return isVerifiedActivitySession(session) ? session : null;
}

const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

function isFundingFee(value: unknown): boolean {
  return isRecord(value) && typeof value.label === "string" && typeof value.amount === "string" &&
    decimalPattern.test(value.amount) && typeof value.currency === "string";
}

function isTrustedFundingOrderSummary(value: unknown): boolean {
  if (!isFundingOrderSummary(value)) return false;
  return (value.fees === undefined || value.fees.every(isFundingFee)) && value.instructions === null;
}


export function trustRestoredActivity(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  const owner = restoredOwner(entry.ownerKey);
  const session = owner ? activitySession(owner) : null;
  const windowEnd = entry.queryKey[2];
  const currency = entry.queryKey[3];
  if (!session || !isRecord(data) || !Array.isArray(data.pageParams) || !Array.isArray(data.pages) ||
    data.pages.length === 0 || data.pages.length !== data.pageParams.length ||
    typeof windowEnd !== "string" || !isActivityValuationCurrency(currency) || !data.pages.every(isRecord)) return null;
  const pageParams: unknown[] = data.pageParams;
  try {
    const pages = data.pages.map((page) =>
      parseActivityPage({ ...page, version: ACTIVITY_CONTRACT_VERSION }, session, windowEnd, currency));
    if (data.pageParams[0] !== null ||
      !data.pageParams.every((param, index) =>
        index === 0 || (typeof pages[index - 1]?.nextCursor === "string" && param === pages[index - 1]?.nextCursor))) return null;
    mergeActivityPages(pages);
    return { data: { pages, pageParams: [...pageParams] } };
  } catch {
    return null;
  }
}

export function trustRestoredBalances(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  const owner = restoredOwner(entry.ownerKey);
  const requestedRegion = entry.queryKey[2];
  if (!owner || owner.chainId !== BALANCES_CHAIN_ID || typeof requestedRegion !== "string") return null;
  const region = regionIds.find((candidate) => candidate === requestedRegion);
  if (!region) return null;
  try {
    return {
      data: parseBalancesSnapshot(data, {
        subject: owner.subject,
        smartAccountAddress: owner.address,
        chainId: owner.chainId,
      }, region),
    };
  } catch {
    return null;
  }
}

export function trustRestoredBorrowOverview(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  const owner = restoredOwner(entry.ownerKey);
  if (!owner || entry.queryKey.length !== 3 || entry.queryKey[1] !== "borrow" || entry.queryKey[2] !== "overview") return null;
  const overview = parseBorrowOverview(data, owner.address);
  return overview ? { data: overview } : null;
}

export function trustRestoredBorrowMarket(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  const owner = restoredOwner(entry.ownerKey);
  if (!owner || entry.queryKey.length !== 3 || entry.queryKey[1] !== "borrow-market") return null;
  const snapshot = parseSnapshot(data, owner.address);
  return snapshot && snapshot.market.id === entry.queryKey[2] ? { data: snapshot } : null;
}

export function trustRestoredFundingOpenOrder(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  if (!isRecord(data)) return null;
  if (data.order === null) return { data };
  if (!isRecord(data.order) || !isTrustedFundingOrderSummary(data.order)) return null;
  const { region } = data.order;
  return region === undefined || region === entry.queryKey[2] ? { data } : null;
}

export function trustRestoredFundingOpenOrderByProvider(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  const region = entry.queryKey[2];
  const providerId = entry.queryKey[3];
  const methodIds = entry.queryKey[4];
  if (!isRecord(data) || typeof region !== "string" || typeof providerId !== "string" || typeof methodIds !== "string") return null;
  if (data.order === null) return { data };
  if (!isRecord(data.order) || !isTrustedFundingOrderSummary(data.order)) return null;
  const { providerId: orderProviderId, region: orderRegion, paymentMethod } = data.order;
  const methods = methodIds === "" ? [] : methodIds.split(",");
  return orderProviderId === providerId && (orderRegion === undefined || orderRegion === region) &&
    (paymentMethod === undefined || typeof paymentMethod === "string" && methods.includes(paymentMethod))
    ? { data }
    : null;
}

export function trustRestoredFundingOrder(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  return isTrustedFundingOrderSummary(data) && isFundingOrderSummary(data) && data.id === entry.queryKey[2] ? { data } : null;
}

export function trustRestoredFundingProviderCustomers(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  const region = entry.queryKey[2];
  if (!isRecord(data) || !Array.isArray(data.customers) || typeof region !== "string") return null;
  const customers = readFundingProviderCustomers(data);
  return customers.length === data.customers.length && customers.every((customer) => customer.region === region)
    ? { data }
    : null;
}

export function trustRestoredFundingProviders(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  const region = entry.queryKey[2];
  if (!isRecord(data) || !Array.isArray(data.providers) || typeof region !== "string") return null;
  const providers = readProviderBindings(data);
  return providers.length === data.providers.length && providers.every((provider) => provider.region === region)
    ? { data }
    : null;
}

export function trustRestoredStockTradeEligibility(data: unknown): TrustedRestoredData | null {
  const parsed = parseStockTradeEligibilityResponse(data);
  return parsed ? { data: parsed } : null;
}

export function trustRestoredTradeAvailability(data: unknown, entry: RestoredQueryEntry): TrustedRestoredData | null {
  const parsed = parseTradeAvailabilityResponse(data);
  if (!parsed) return null;
  return parsed.status === "available" && parsed.token.assetId !== entry.queryKey[2] ? null : { data: parsed };
}
