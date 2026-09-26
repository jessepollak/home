export const NETWORK_FEE_POLICY_VERSION = 1 as const;

export type NetworkFeePolicyResponse = {
  version: typeof NETWORK_FEE_POLICY_VERSION;
  usdcReserveBaseUnits: string | null;
};

export function parseNetworkFeePolicyResponse(value: unknown): NetworkFeePolicyResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== NETWORK_FEE_POLICY_VERSION) return null;
  if (record.usdcReserveBaseUnits === null) {
    return { version: NETWORK_FEE_POLICY_VERSION, usdcReserveBaseUnits: null };
  }
  if (typeof record.usdcReserveBaseUnits !== "string" || !/^[1-9]\d{0,17}$/.test(record.usdcReserveBaseUnits)) {
    return null;
  }
  return { version: NETWORK_FEE_POLICY_VERSION, usdcReserveBaseUnits: record.usdcReserveBaseUnits };
}
