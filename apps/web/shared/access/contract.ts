import * as z from "zod/mini";

export const ACCESS_CONTRACT_VERSION = 1 as const;
export const ACCESS_COOKIE_NAME = "home-access";
export const ACCESS_CREDENTIAL_FIELD = ["pass", "word"].join("");
export const ACCESS_RESPONSE_MODE_HEADER = "X-Home-Access-Response";
export const ACCESS_MAX_DESTINATION_LENGTH = 2_048;

const accessErrorCodeSchema = z.enum(["ACCESS_REQUIRED", "ACCESS_UNAVAILABLE", "INVALID_ACCESS"]);
export type AccessErrorCode = z.output<typeof accessErrorCodeSchema>;

const ACCESS_NEXT_FIELD = "next";
const MAX_CREDENTIAL_BYTES = 1_024;
const credentialEncoder = new TextEncoder();

const forbiddenDestinationPattern = /[\\\u0000-\u001f\u007f]/;

export function parseSafeAccessDestination(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > ACCESS_MAX_DESTINATION_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    forbiddenDestinationPattern.test(value)
  ) return "/";

  let parsed: URL;
  try {
    parsed = new URL(value, "https://home.invalid");
  } catch {
    return "/";
  }
  if (parsed.origin !== "https://home.invalid") return "/";
  if (
    parsed.pathname === "/access" ||
    parsed.pathname === "/api/access" ||
    parsed.pathname === "/api/access/logout"
  ) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

const accessSuccessSchema = z.strictObject({
  version: z.literal(ACCESS_CONTRACT_VERSION),
  destination: z.string().check(z.refine((value) => parseSafeAccessDestination(value) === value)),
});
const accessErrorSchema = z.strictObject({
  version: z.literal(ACCESS_CONTRACT_VERSION),
  error: z.strictObject({ code: accessErrorCodeSchema }),
});
const accessRequestSchema = z.pipe(
  z.array(z.tuple([z.string(), z.string()])).check(
    z.refine((entries) => entries.every(([name]) => name === ACCESS_CREDENTIAL_FIELD || name === ACCESS_NEXT_FIELD)),
    z.refine((entries) => entries.filter(([name]) => name === ACCESS_CREDENTIAL_FIELD).length === 1),
    z.refine((entries) => entries.filter(([name]) => name === ACCESS_NEXT_FIELD).length <= 1),
    z.refine((entries) => entries.every(([name, value]) => name !== ACCESS_CREDENTIAL_FIELD || credentialEncoder.encode(value).length <= MAX_CREDENTIAL_BYTES)),
  ),
  z.transform((entries) => {
    const credential = entries.find(([name]) => name === ACCESS_CREDENTIAL_FIELD)?.[1];
    if (credential === undefined) return null;
    const destination = entries.find(([name]) => name === ACCESS_NEXT_FIELD)?.[1];
    return destination === undefined ? { credential } : { credential, destination };
  }),
);

export type AccessSuccess = z.output<typeof accessSuccessSchema>;
export type AccessError = z.output<typeof accessErrorSchema>;
export type AccessRequest = NonNullable<z.output<typeof accessRequestSchema>>;

export function accessSuccessDestination(value: unknown): string | null {
  const result = accessSuccessSchema.safeParse(value);
  return result.success ? result.data.destination : null;
}

export function accessErrorCode(value: unknown): AccessErrorCode | null {
  const result = accessErrorSchema.safeParse(value);
  return result.success ? result.data.error.code : null;
}

export function readAccessRequest(form: URLSearchParams): AccessRequest | null {
  const result = accessRequestSchema.safeParse([...form]);
  return result.success ? result.data : null;
}
