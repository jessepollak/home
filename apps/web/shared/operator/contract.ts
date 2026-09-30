import { parseAddress, type Address } from "@/shared/chain/hex";
export const OPERATOR_CONTRACT_VERSION = 1 as const;

export type OperatorSessionResponse = {
  version: typeof OPERATOR_CONTRACT_VERSION;
  operator: { address: Address };
};

export type OperatorErrorCode = "UNAUTHENTICATED" | "OPERATOR_FORBIDDEN" | "NOT_FOUND";
export type OperatorErrorResponse = { error: { code: OperatorErrorCode } };

/** @public parses the administrator session endpoint for future clients */
export function parseOperatorSessionResponse(value: unknown): OperatorSessionResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as { version?: unknown; operator?: { address?: unknown } };
  const address = parseAddress(response.operator?.address);
  if (response.version !== OPERATOR_CONTRACT_VERSION || !address) return null;
  return { version: OPERATOR_CONTRACT_VERSION, operator: { address } };
}

/** @public parses administrator API errors for future clients */
export function parseOperatorErrorResponse(value: unknown): OperatorErrorResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as { error?: { code?: unknown } };
  const code = response.error?.code;
  return code === "UNAUTHENTICATED" || code === "OPERATOR_FORBIDDEN" || code === "NOT_FOUND"
    ? { error: { code } }
    : null;
}
