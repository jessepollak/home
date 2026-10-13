import * as z from "zod/mini";

export const CARDS_CONTRACT_VERSION = 2 as const;
const cardStateSchema = z.enum(["not-enrolled", "verification-required", "verification-pending", "ineligible", "ready-to-issue", "active", "frozen", "restricted", "canceled", "unavailable"]);
const cardSourceSchema = z.enum(["available", "unavailable", "not-requested"]);
const cardStatusSchema = z.enum(["active", "frozen", "restricted", "canceled"]);
const cardWriteErrorCodeSchema = z.enum(["CARDS_UNAVAILABLE", "CARD_NOT_READY", "CARD_CONFLICT", "CARD_NOT_FOUND", "INVALID_CARD_REQUEST", "CROSS_ORIGIN"]);
const cardIdSchema = z.string().check(z.uuid());
const issuingCardSchema = z.string().check(z.regex(/^ic_[A-Za-z0-9]+$/));
const nonceSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]{8,256}$/));
const cardsResponseSchema = z.readonly(z.looseObject({
  version: z.literal(CARDS_CONTRACT_VERSION), state: cardStateSchema,
  cards: z.readonly(z.array(z.readonly(z.looseObject({ id: cardIdSchema, status: cardStatusSchema, last4: z.string().check(z.regex(/^\d{4}$/)) })))),
  provenance: z.readonly(z.looseObject({ program: z.nullable(z.enum(["bridge", "rain", "immersve"])), account: cardSourceSchema,
    cards: cardSourceSchema, fetchedAt: z.string().check(z.refine((value) => Number.isFinite(Date.parse(value)))) })),
}));
const cardsErrorSchema = z.readonly(z.looseObject({ version: z.literal(CARDS_CONTRACT_VERSION), error: z.readonly(z.looseObject({ code: z.literal("CARDS_UNAVAILABLE") })) }));
const cardWriteErrorSchema = z.readonly(z.looseObject({ version: z.literal(CARDS_CONTRACT_VERSION), error: z.readonly(z.looseObject({ code: cardWriteErrorCodeSchema })) }));
const enrollmentNextSchema = z.union([
  z.strictObject({ kind: z.literal("redirect"), url: z.string().check(z.refine((value) => {
    try { const url = new URL(value); return url.protocol === "https:" && url.host === "bridge.withpersona.com" && !url.username && !url.password && !url.hash; }
    catch { return false; }
  })) }),
  z.strictObject({ kind: z.literal("complete") }),
]);
const cardEnrollmentResponseSchema = z.readonly(z.looseObject({ version: z.literal(CARDS_CONTRACT_VERSION), next: enrollmentNextSchema }));
const cardWriteResponseSchema = z.readonly(z.looseObject({ version: z.literal(CARDS_CONTRACT_VERSION), card: z.readonly(z.looseObject({ id: cardIdSchema, status: z.enum(["active", "frozen"]) })) }));
const revealRequestSchema = z.union([
  z.strictObject({ method: z.literal("stripe-issuing-elements"), step: z.literal("prepare") }),
  z.strictObject({ method: z.literal("stripe-issuing-elements"), step: z.literal("grant"), nonce: nonceSchema }),
]);
const revealGrantSchema = z.union([
  z.strictObject({ method: z.literal("stripe-issuing-elements"), step: z.literal("prepare"), issuingCard: issuingCardSchema }),
  z.strictObject({ method: z.literal("stripe-issuing-elements"), step: z.literal("grant"), issuingCard: issuingCardSchema,
    ephemeralKeySecret: z.string().check(z.regex(/^ek_(test|live)_[A-Za-z0-9_-]{10,2048}$/)), nonce: nonceSchema }),
]);
const cardRevealResponseSchema = z.readonly(z.strictObject({ version: z.literal(CARDS_CONTRACT_VERSION), cardId: cardIdSchema, grant: revealGrantSchema }));

export type CardState = z.output<typeof cardStateSchema>;
export type CardsResponse = z.output<typeof cardsResponseSchema>;
export type CardsError = z.output<typeof cardsErrorSchema>;
export type CardWriteErrorCode = z.output<typeof cardWriteErrorCodeSchema>;
export type CardWriteError = z.output<typeof cardWriteErrorSchema>;
export type CardEnrollmentResponse = z.output<typeof cardEnrollmentResponseSchema>;
export type CardWriteResponse = z.output<typeof cardWriteResponseSchema>;
export type RevealRequest = Readonly<z.output<typeof revealRequestSchema>>;
export type RevealGrant = Readonly<z.output<typeof revealGrantSchema>>;
export type CardRevealResponse = z.output<typeof cardRevealResponseSchema>;

const originalCardsResponseSchema = z.custom<CardsResponse>((value) => cardsResponseSchema.safeParse(value).success);
const originalCardWriteErrorSchema = z.custom<CardWriteError>((value) => cardWriteErrorSchema.safeParse(value).success);
const originalCardEnrollmentResponseSchema = z.custom<CardEnrollmentResponse>((value) => cardEnrollmentResponseSchema.safeParse(value).success);
const originalCardWriteResponseSchema = z.custom<CardWriteResponse>((value) => cardWriteResponseSchema.safeParse(value).success);
const originalCardRevealResponseSchema = z.custom<CardRevealResponse>((value) => cardRevealResponseSchema.safeParse(value).success);

export function parseCardRevealRequest(value: unknown): RevealRequest | null {
  const result = revealRequestSchema.safeParse(value); return result.success ? result.data : null;
}
export function parseCardRevealResponse(value: unknown): CardRevealResponse | null {
  const result = originalCardRevealResponseSchema.safeParse(value); return result.success ? result.data : null;
}
export function parseCardEnrollmentResponse(value: unknown): CardEnrollmentResponse | null {
  const result = originalCardEnrollmentResponseSchema.safeParse(value); return result.success ? result.data : null;
}
export function parseCardWriteResponse(value: unknown): CardWriteResponse | null {
  const result = originalCardWriteResponseSchema.safeParse(value); return result.success ? result.data : null;
}
export function parseCardWriteError(value: unknown): CardWriteError | null {
  const result = originalCardWriteErrorSchema.safeParse(value); return result.success ? result.data : null;
}
export function parseCardsResponse(value: unknown): CardsResponse | null {
  const result = originalCardsResponseSchema.safeParse(value); return result.success ? result.data : null;
}
