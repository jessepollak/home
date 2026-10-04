import * as z from "zod/mini";

export const CARDS_CONTRACT_VERSION = 1 as const;

const cardStateSchema = z.custom<"not-enrolled" | "verification-required" | "verification-pending" | "ineligible" | "ready-to-issue" | "active" | "frozen" | "restricted" | "canceled" | "unavailable">((value) =>
  typeof value === "string" && ["not-enrolled", "verification-required", "verification-pending", "ineligible", "ready-to-issue", "active", "frozen", "restricted", "canceled", "unavailable"].includes(value));
const cardSourceSchema = z.custom<"available" | "unavailable" | "not-requested">((value) =>
  typeof value === "string" && ["available", "unavailable", "not-requested"].includes(value));
const cardStatusSchema = z.custom<"active" | "frozen" | "restricted" | "canceled">((value) =>
  typeof value === "string" && ["active", "frozen", "restricted", "canceled"].includes(value));
const cardWriteErrorCodeSchema = z.custom<"CARDS_UNAVAILABLE" | "CARD_NOT_READY" | "CARD_CONFLICT" | "CARD_NOT_FOUND" | "INVALID_CARD_REQUEST" | "CROSS_ORIGIN">((value) =>
  typeof value === "string" && ["CARDS_UNAVAILABLE", "CARD_NOT_READY", "CARD_CONFLICT", "CARD_NOT_FOUND", "INVALID_CARD_REQUEST", "CROSS_ORIGIN"].includes(value));
const cardIdSchema = z.string().check(z.regex(/^ic_[A-Za-z0-9]+$/));
const ephemeralKeySecretSchema = z.string().check(z.regex(/^ek_(test|live)_[A-Za-z0-9_-]{10,2048}$/));
const cardsResponseSchema = z.readonly(z.looseObject({
  version: z.literal(CARDS_CONTRACT_VERSION),
  state: cardStateSchema,
  cards: z.readonly(z.array(z.readonly(z.looseObject({ id: cardIdSchema, status: cardStatusSchema, last4: z.string().check(z.regex(/^\d{4}$/)) })))),
  provenance: z.readonly(z.looseObject({ bridge: cardSourceSchema, stripe: cardSourceSchema, fetchedAt: z.string().check(z.refine((value) => Number.isFinite(Date.parse(value)))) })),
}));
const cardsErrorSchema = z.readonly(z.looseObject({ version: z.literal(CARDS_CONTRACT_VERSION), error: z.readonly(z.looseObject({ code: z.literal("CARDS_UNAVAILABLE") })) }));
const cardWriteErrorSchema = z.readonly(z.looseObject({ version: z.literal(CARDS_CONTRACT_VERSION), error: z.readonly(z.looseObject({ code: cardWriteErrorCodeSchema })) }));
const cardEnrollmentResponseSchema = z.readonly(z.looseObject({
  version: z.literal(CARDS_CONTRACT_VERSION),
  kycUrl: z.string().check(z.refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "bridge.withpersona.com" && !url.username && !url.password && !url.hash;
    } catch { return false; }
  })),
}));
const cardWriteResponseSchema = z.readonly(z.looseObject({ version: z.literal(CARDS_CONTRACT_VERSION), card: z.readonly(z.looseObject({ id: cardIdSchema, status: z.enum(["active", "frozen"]) })) }));
const cardEphemeralKeyRequestSchema = z.strictObject({ nonce: z.string().check(z.regex(/^[A-Za-z0-9_-]{8,256}$/)) });
const cardEphemeralKeyResponseSchema = z.readonly(z.looseObject({ version: z.literal(CARDS_CONTRACT_VERSION), cardId: cardIdSchema, ephemeralKeySecret: ephemeralKeySecretSchema }));

export type CardState = z.output<typeof cardStateSchema>;
export type CardsResponse = z.output<typeof cardsResponseSchema>;
export type CardsError = z.output<typeof cardsErrorSchema>;
export type CardWriteErrorCode = z.output<typeof cardWriteErrorCodeSchema>;
export type CardWriteError = z.output<typeof cardWriteErrorSchema>;
export type CardEnrollmentResponse = z.output<typeof cardEnrollmentResponseSchema>;
export type CardWriteResponse = z.output<typeof cardWriteResponseSchema>;
export type CardEphemeralKeyRequest = Readonly<z.output<typeof cardEphemeralKeyRequestSchema>>;
export type CardEphemeralKeyResponse = z.output<typeof cardEphemeralKeyResponseSchema>;

const originalCardsResponseSchema = z.custom<CardsResponse>((value) => cardsResponseSchema.safeParse(value).success);
const originalCardWriteErrorSchema = z.custom<CardWriteError>((value) => cardWriteErrorSchema.safeParse(value).success);
const originalCardEnrollmentResponseSchema = z.custom<CardEnrollmentResponse>((value) => cardEnrollmentResponseSchema.safeParse(value).success);
const originalCardWriteResponseSchema = z.custom<CardWriteResponse>((value) => cardWriteResponseSchema.safeParse(value).success);
const originalCardEphemeralKeyResponseSchema = z.custom<CardEphemeralKeyResponse>((value) => cardEphemeralKeyResponseSchema.safeParse(value).success);

export function parseCardEphemeralKeyRequest(value: unknown): CardEphemeralKeyRequest | null {
  const result = cardEphemeralKeyRequestSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseCardEphemeralKeyResponse(value: unknown): CardEphemeralKeyResponse | null {
  const result = originalCardEphemeralKeyResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseCardEnrollmentResponse(value: unknown): CardEnrollmentResponse | null {
  const result = originalCardEnrollmentResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseCardWriteResponse(value: unknown): CardWriteResponse | null {
  const result = originalCardWriteResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseCardWriteError(value: unknown): CardWriteError | null {
  const result = originalCardWriteErrorSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseCardsResponse(value: unknown): CardsResponse | null {
  const result = originalCardsResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
