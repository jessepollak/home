// Route contract.
// POST /api/auth/base/nonce

export type NativeBaseNonceRequest = { address: `0x${string}` };
export type NativeBaseNonceResponse = { message: string; expiresAt: string };
export type NativeBaseNonceErrorCode = "AUTH_UNAVAILABLE" | "INVALID_REQUEST";

export function parseNativeBaseNonceResponse(value: unknown): NativeBaseNonceResponse | null {
  if (
    !value || typeof value !== "object" ||
    !("message" in value) || typeof value.message !== "string" ||
    value.message.length === 0 || value.message.length > 16_384
  ) return null;
  return {
    message: value.message,
    expiresAt: "expiresAt" in value && typeof value.expiresAt === "string"
      ? value.expiresAt
      : "",
  };
}
