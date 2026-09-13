// Route contract.
// GET /api/funding/providers

export type FundingBinding = {
  providerId: string;
  displayName: string;
  region: string;
  assetId: string;
  assetSymbol: string;
  assetDecimals: number;
  currency: string;
  paymentMethods: ReadonlyArray<{ id: string; label: string }>;
  quotes: boolean;
  kyc: { terms?: { url: string }; fields?: ReadonlyArray<{ name: string; label: string; type: "text" | "email" | "date" | "select"; options?: ReadonlyArray<string> }> } | null;
};

export type FundingProvidersResponse = { providers: ReadonlyArray<FundingBinding> };
export type FundingProvidersErrorCode = "INVALID_REGION" | string;

export function readProviderBindings(value: unknown): ReadonlyArray<FundingBinding> {
  if (!isRecord(value) || !Array.isArray(value.providers)) return [];
  return value.providers.filter((item): item is FundingBinding =>
    isRecord(item) &&
    typeof item.providerId === "string" &&
    typeof item.displayName === "string" &&
    typeof item.region === "string" &&
    typeof item.assetId === "string" &&
    typeof item.assetSymbol === "string" &&
    Number.isSafeInteger(item.assetDecimals) &&
    typeof item.currency === "string" &&
    Array.isArray(item.paymentMethods)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
