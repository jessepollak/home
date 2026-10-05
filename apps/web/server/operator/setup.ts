import "server-only";

import { z } from "zod";
import { isHomeSessionConfigured } from "@/server/auth/native-base-session";
import { resolveBaseRpcUrl, resolveEthereumRpcUrl } from "@/server/chain/rpc";
import { envGetter, readBaseRpcUrl, readCdpCredentials, readCodexApiKey, readDatabaseUrl, readEthereumRpcUrl, readHomeSessionSecret, readVercelDeploymentId, readVercelEnvironment, serverEnvironment } from "@/server/config/env";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { writeObservabilityEvent } from "@/server/observability/log";
import { readOperatorConfig } from "@/server/operator/config";
import { resolveSecretKeyring } from "@/server/secrets/at-rest";
import type { OperatorSetup, RunningBuild, SetupState, SetupStep, SetupVariable } from "@/shared/operator/setup";

type Environment = Readonly<Record<string, string | undefined>>;
type SetupDependencies = { env?: Environment; sql?: Pick<SqlExecutor, "query"> };
const deploymentDoc = "https://github.com/jessepollak/home/blob/main/docs/vercel-deploy.md";
const checklistDoc = "https://github.com/jessepollak/home/blob/main/docs/operator-checklist.md#environment-variables";
const readProjectId = envGetter("NEXT_PUBLIC_CDP_PROJECT_ID", z.string().trim().min(1).optional(), () => undefined);
const readFundingQuoteSecret = envGetter("FUNDING_QUOTE_SECRET", z.string().trim().min(1).optional(), () => undefined);
const readCommit = envGetter("VERCEL_GIT_COMMIT_SHA", z.string().regex(/^[0-9a-f]{40}$/).optional(), () => undefined);
const readBranch = envGetter("VERCEL_GIT_COMMIT_REF", z.string().trim().min(1).optional(), () => undefined);

function variable(name: string, value: string | undefined, valid = true): SetupVariable {
  return { name, state: !value?.trim() ? "unset" : valid ? "set" : "invalid" };
}

function envStep(id: string, title: string, variables: SetupVariable[], detail: string, documentationHref: string): SetupStep {
  const state = variables.some((entry) => entry.state === "invalid") ? "invalid" : variables.some((entry) => entry.state === "unset") ? "missing" : "ready";
  return { id, title, state, variables, detail, documentationHref };
}

function rpcVariable(name: string, value: string | undefined, resolve: (value: string) => string): SetupVariable {
  if (!value) return variable(name, value);
  try {
    resolve(value);
    return variable(name, value);
  } catch {
    return variable(name, value, false);
  }
}

async function databaseStep(env: Environment, sql: SetupDependencies["sql"]): Promise<SetupStep> {
  const configured = readDatabaseUrl(env);
  let state: SetupState = "missing";
  if (configured) {
    try {
      const result = await (sql ?? getSqlExecutor(env)).query<{ migrations: boolean; settings: boolean }>(
        "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS migrations, to_regclass('public.operator_settings') IS NOT NULL AS settings",
        [],
        { signal: AbortSignal.timeout(2_000), timeoutMs: 2_000 },
      );
      state = result.rows[0]?.migrations && result.rows[0]?.settings ? "ready" : "needs-migration";
    } catch (error) {
      writeObservabilityEvent({ kind: "unhandled-server-error", route: "/admin", errorName: error instanceof Error ? error.name : "UnknownError" });
      state = "unavailable";
    }
  }
  const detail = state === "ready" ? "Database connected and required tables present."
    : state === "unavailable" ? "Database is configured but unavailable. Check database access and availability, then return to Admin."
    : state === "needs-migration" ? "Redeploy production so its build applies migrations; Setup instructions cover the manual path."
    : "A database is required to save settings.";
  return { id: "database", title: "Database", state, variables: [variable("DATABASE_URL", configured)], detail, documentationHref: `${deploymentDoc}#environment` };
}

function runningBuild(env: Environment): RunningBuild {
  const commit = readCommit(env);
  return commit ? { kind: "deployment", commit, branch: readBranch(env) ?? null, deploymentId: readVercelDeploymentId(env)?.trim() || null, environment: readVercelEnvironment(env)?.trim() || null } : { kind: "unavailable" };
}

export async function readOperatorSetup(deps: SetupDependencies = {}): Promise<OperatorSetup> {
  const env = deps.env ?? serverEnvironment();
  const session = readHomeSessionSecret(env);
  const operators = readOperatorConfig(env);
  const cdp = readCdpCredentials(env);
  const keyring = resolveSecretKeyring(env);
  const fundingSecret = readFundingQuoteSecret(env);
  const keyVariables = [
    variable("HOME_SECRET_ENCRYPTION_KEY", env.HOME_SECRET_ENCRYPTION_KEY, keyring.ok || keyring.reason !== "invalid-key"),
    variable("HOME_SECRET_KEY_VERSION", env.HOME_SECRET_KEY_VERSION, keyring.ok || keyring.reason !== "invalid-version"),
  ];
  if (env.HOME_SECRET_ENCRYPTION_KEY_PREVIOUS) {
    keyVariables.push(variable("HOME_SECRET_ENCRYPTION_KEY_PREVIOUS", env.HOME_SECRET_ENCRYPTION_KEY_PREVIOUS, keyring.ok || keyring.reason !== "invalid-previous"));
  }
  const required = [
    envStep("session", "Session signing", [variable("HOME_SESSION_SECRET", session, isHomeSessionConfigured(session))], "Use a session secret of at least 32 UTF-8 bytes.", `${deploymentDoc}#administrator-access`),
    envStep("operators", "Administrators", [variable("HOME_OPERATOR_ADDRESSES", env.HOME_OPERATOR_ADDRESSES, operators.kind !== "misconfigured")], operators.kind === "configured" ? `${operators.addresses.size} administrator${operators.addresses.size === 1 ? "" : "s"} configured.` : "Use a comma-separated list of unique 0x addresses with 40 hex characters.", `${deploymentDoc}#administrator-access`),
    await databaseStep(env, deps.sql),
  ];
  const optional = [
    envStep("email", "Email sign-in", [variable("NEXT_PUBLIC_CDP_PROJECT_ID", readProjectId(env)), variable("CDP_API_KEY_ID", cdp.status === "complete" ? cdp.apiKeyId : env.CDP_API_KEY_ID), variable("CDP_API_KEY_SECRET", cdp.status === "complete" ? cdp.apiKeySecret : env.CDP_API_KEY_SECRET)], "Configure a CDP project and its server credentials for email sign-in.", `${deploymentDoc}#environment`),
    envStep("rpc", "Hosted RPC", [rpcVariable("BASE_RPC_URL", readBaseRpcUrl(env), resolveBaseRpcUrl), rpcVariable("ETHEREUM_RPC_URL", readEthereumRpcUrl(env), resolveEthereumRpcUrl)], "Configure dedicated Base and Ethereum RPC endpoints.", `${deploymentDoc}#environment`),
    envStep("prices", "Prices", [variable("CODEX_API_KEY", readCodexApiKey(env))], "Configure a Codex key for market prices.", `${deploymentDoc}#environment`),
    envStep("keyring", "Secrets keyring", keyVariables, "Use a 32-byte unpadded base64url encryption key and a positive key version.", `${deploymentDoc}#cdp-balance-activity-webhook`),
    envStep("funding", "Funding quotes", [variable("FUNDING_QUOTE_SECRET", fundingSecret, (fundingSecret?.length ?? 0) >= 32)], "Use a funding quote secret of at least 32 characters.", checklistDoc),
  ];
  return { required, optional, requiredStepsLeft: required.filter((step) => step.state !== "ready").length, build: runningBuild(env) };
}
