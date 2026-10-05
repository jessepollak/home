import "server-only";

import { z } from "zod";
import { ALLOWED_ENV_NAMES, type AllowedEnvName } from "./env-names";

type Environment = Readonly<Record<string, string | undefined>>;
type CdpCredentials =
  | { status: "unset" }
  | { status: "partial" }
  | { status: "complete"; apiKeyId: string; apiKeySecret: string };

const allowedEnvNames: ReadonlySet<string> = new Set(ALLOWED_ENV_NAMES);

export function serverEnvironment(): Environment {
  return process.env;
}

export function envGetter<Name extends AllowedEnvName, Value>(name: Name, schema: z.ZodType<Value>, fallback: () => Value) {
  if (!allowedEnvNames.has(name)) throw new Error("Environment name is not documented in .env.example.");
  return (env: Environment = serverEnvironment()): Value => {
    const result = schema.safeParse(env[name]);
    return result.success ? result.data : fallback();
  };
}

const optionalCredential = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? undefined : value,
  z.string().trim().min(1).optional(),
);
type CredentialRead = { valid: true; value: string | undefined } | { valid: false };
const cdpCredentialSchema = optionalCredential.transform((value): CredentialRead => ({ valid: true, value }));
const readCdpApiKeyId = envGetter("CDP_API_KEY_ID", cdpCredentialSchema, (): CredentialRead => ({ valid: false }));
const readCdpApiKeySecret = envGetter("CDP_API_KEY_SECRET", cdpCredentialSchema, (): CredentialRead => ({ valid: false }));

export function readCdpCredentials(env: Environment = serverEnvironment()): CdpCredentials {
  const id = readCdpApiKeyId(env);
  const secret = readCdpApiKeySecret(env);
  if (!id.valid || !secret.valid) return { status: "partial" };
  if (!id.value && !secret.value) return { status: "unset" };
  if (!id.value || !secret.value) return { status: "partial" };
  return { status: "complete", apiKeyId: id.value, apiKeySecret: secret.value };
}

export const readCodexApiKey = envGetter("CODEX_API_KEY", optionalCredential, () => undefined);

export const readDatabaseUrl = envGetter("DATABASE_URL", optionalCredential, () => undefined);
export const readHomeSessionSecret = envGetter("HOME_SESSION_SECRET", optionalCredential, () => undefined);
export const readBaseRpcUrl = envGetter("BASE_RPC_URL", optionalCredential, () => undefined);
export const readEthereumRpcUrl = envGetter("ETHEREUM_RPC_URL", optionalCredential, () => undefined);
export const readVercelEnvironment = envGetter("VERCEL_ENV", z.string().optional(), () => undefined);
export const readVercelDeploymentId = envGetter("VERCEL_DEPLOYMENT_ID", z.string().optional(), () => undefined);
export const readCdpPaymasterUrl = envGetter("CDP_PAYMASTER_URL", optionalCredential, () => undefined);
export const readBaseAccountStatusRpcUrl = envGetter("BASE_ACCOUNT_STATUS_RPC_URL", optionalCredential, () => undefined);
