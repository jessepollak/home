import * as z from "zod/mini";
import { sanitizeIdentifier, scrubString, sanitizeRoutePath } from "@/shared/observability/scrub";

export const CLIENT_ERROR_CONTRACT_VERSION = 1 as const;

const clientErrorReportSchema = z.pipe(
  z.strictObject({
    version: z.exactOptional(z.literal(CLIENT_ERROR_CONTRACT_VERSION)),
    name: z.string().check(z.minLength(1), z.maxLength(80)),
    message: z.string().check(z.minLength(1), z.maxLength(1_024)),
    route: z.string().check(z.minLength(1), z.maxLength(512),
      z.refine((route) => route.startsWith("/") && !route.startsWith("//") && !route.includes("://"))),
  }),
  z.transform((report) => ({
    name: sanitizeIdentifier(report.name, "Error"),
    message: scrubString(report.message).trim().slice(0, 256),
    route: sanitizeRoutePath(report.route),
  })),
);

export type ClientErrorReport = z.output<typeof clientErrorReportSchema>;

export function parseClientErrorReport(value: unknown): ClientErrorReport | null {
  const result = clientErrorReportSchema.safeParse(value);
  return result.success && result.data.message.length > 0 ? result.data : null;
}
