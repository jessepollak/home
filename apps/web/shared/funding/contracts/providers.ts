// Route contract.
// GET /api/funding/providers?region=US&direction=onramp|offramp

export const FUNDING_PROVIDERS_VERSION = 2 as const;

type FundingBindingBase = {
  providerId: string;
  displayName: string;
  region: string;
  assetId: string;
  assetSymbol: string;
  assetDecimals: number;
  currency: string;
};

export type FundingOnrampBinding = FundingBindingBase & {
  direction: "onramp";
  paymentMethods: ReadonlyArray<{ id: string; label: string }>;
  quotes: boolean;
  kyc: { terms?: { url: string }; fields?: ReadonlyArray<{ name: string; label: string; type: "text" | "email" | "date" | "select"; options?: ReadonlyArray<string> }> } | null;
};

export type FundingOfframpBinding = FundingBindingBase & {
  direction: "offramp";
  paymentMethods: ReadonlyArray<{
    id: string;
    label: string;
    platform: string;
    handleHint: string;
    minimumAmountAtomic: string;
    maximumAmountAtomic: string | null;
    estimateSemantics: "approximate";
    etaSemantics: "historical-not-guaranteed";
    corridorConfirmedBy: string;
  }>;
  quotes: false;
  kyc: null;
};

export type FundingBinding = FundingOnrampBinding | FundingOfframpBinding;
export type FundingProvidersResponse = {
  version: typeof FUNDING_PROVIDERS_VERSION;
  direction: FundingBinding["direction"];
  providers: ReadonlyArray<FundingBinding>;
};
export type FundingProvidersErrorCode = "INVALID_REGION" | "INVALID_DIRECTION" | string;

export function readProviderBindings(value: unknown): ReadonlyArray<FundingBinding> {
  if (!isRecord(value) || !Array.isArray(value.providers)) return [];
  const parsed: FundingBinding[] = [];
  for (const item of value.providers) {
    if (!isBaseBinding(item) || !Array.isArray(item.paymentMethods)) continue;
    const direction = item.direction === undefined ? "onramp" : item.direction;
    if (direction === "onramp") {
      if (typeof item.quotes !== "boolean" || !(item.kyc === null || isRecord(item.kyc))) continue;
      const paymentMethods = item.paymentMethods.filter(isPaymentMethod);
      if (paymentMethods.length !== item.paymentMethods.length) continue;
      parsed.push({
        providerId: item.providerId, displayName: item.displayName, region: item.region,
        assetId: item.assetId, assetSymbol: item.assetSymbol, assetDecimals: item.assetDecimals,
        currency: item.currency, direction, paymentMethods, quotes: item.quotes,
        kyc: item.kyc as FundingOnrampBinding["kyc"],
      });
    } else if (direction === "offramp") {
      const paymentMethods = item.paymentMethods.filter(isOfframpPaymentMethod);
      if (paymentMethods.length !== item.paymentMethods.length || item.quotes !== false || item.kyc !== null) continue;
      parsed.push({
        providerId: item.providerId, displayName: item.displayName, region: item.region,
        assetId: item.assetId, assetSymbol: item.assetSymbol, assetDecimals: item.assetDecimals,
        currency: item.currency, direction, paymentMethods, quotes: false, kyc: null,
      });
    }
  }
  return parsed;
}

function isBaseBinding(value: unknown): value is Record<string, unknown> & FundingBindingBase {
  return isRecord(value) &&
    typeof value.providerId === "string" &&
    typeof value.displayName === "string" &&
    typeof value.region === "string" &&
    typeof value.assetId === "string" &&
    typeof value.assetSymbol === "string" &&
    Number.isSafeInteger(value.assetDecimals) &&
    typeof value.currency === "string";
}

function isPaymentMethod(value: unknown): value is { id: string; label: string } {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string";
}

function isOfframpPaymentMethod(value: unknown): value is FundingOfframpBinding["paymentMethods"][number] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string") return false;
  return typeof value.platform === "string" &&
    typeof value.handleHint === "string" &&
    typeof value.minimumAmountAtomic === "string" &&
    /^(0|[1-9]\d*)$/.test(value.minimumAmountAtomic) &&
    (value.maximumAmountAtomic === null || (typeof value.maximumAmountAtomic === "string" && /^(0|[1-9]\d*)$/.test(value.maximumAmountAtomic))) &&
    value.estimateSemantics === "approximate" &&
    value.etaSemantics === "historical-not-guaranteed" &&
    typeof value.corridorConfirmedBy === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
