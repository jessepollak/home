import * as z from "zod/mini";

export const OPERATOR_SETTINGS_CONTRACT_VERSION = 1 as const;

const settingsSchema = z.looseObject({
  value: z.unknown(),
  revision: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0)),
  source: z.enum(["default", "stored"]),
  updatedAt: z.nullable(z.string()),
  updatedBy: z.nullable(z.string()),
}).check(z.refine((settings) => "value" in settings));

export const settingsEntrySchema = z.looseObject({ domain: z.string(), settings: settingsSchema });
const settingsResponseSchema = z.looseObject({
  ...settingsEntrySchema.shape,
  version: z.literal(OPERATOR_SETTINGS_CONTRACT_VERSION),
});

export type SettingsEntry<T = unknown> = {
  domain: z.output<typeof settingsEntrySchema>["domain"];
  settings: Pick<z.output<typeof settingsSchema>, "revision" | "source" | "updatedAt" | "updatedBy"> & { value: T };
};
export type SettingsResponse = z.output<typeof settingsResponseSchema>;

/** @public parses settings responses for future administrator clients */
export function parseSettingsResponse(value: unknown): SettingsResponse | null {
  const result = settingsResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
