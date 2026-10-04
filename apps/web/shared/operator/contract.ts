import * as z from "zod/mini";
import { parseAddress, type Address } from "@/shared/chain/hex";

export const OPERATOR_CONTRACT_VERSION = 1 as const;

const addressSchema = z.pipe(
  z.string().check(z.refine((value) => parseAddress(value) !== null)),
  z.transform((value): Address => parseAddress(value) as Address),
);
const operatorSessionResponseSchema = z.object({
  version: z.literal(OPERATOR_CONTRACT_VERSION),
  operator: z.object({ address: addressSchema }),
});
const operatorErrorCodeSchema = z.enum(["UNAUTHENTICATED", "OPERATOR_FORBIDDEN", "NOT_FOUND"]);
const operatorErrorResponseSchema = z.object({ error: z.object({ code: operatorErrorCodeSchema }) });

export type OperatorSessionResponse = z.output<typeof operatorSessionResponseSchema>;
export type OperatorErrorResponse = z.output<typeof operatorErrorResponseSchema>;

/** @public parses the administrator session endpoint for future clients */
export function parseOperatorSessionResponse(value: unknown): OperatorSessionResponse | null {
  const result = operatorSessionResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** @public parses administrator API errors for future clients */
export function parseOperatorErrorResponse(value: unknown): OperatorErrorResponse | null {
  const result = operatorErrorResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
