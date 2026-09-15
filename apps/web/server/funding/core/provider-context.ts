import "server-only";

import { getFundingAsset } from "@/shared/funding/assets";
import type {
  FundingDirection,
  FundingOfframpDeployment,
  FundingProviderManifest,
  FundingWebhookManifest,
  OfframpContext,
  ProviderContext,
} from "@/shared/funding/provider-contract";

export const PROVIDER_FETCH_TIMEOUT_MS = 6_000;

export const FUNDING_CONFIGURATION_CODE = "FUNDING_PROVIDER_CONFIGURATION" as const;
export const FUNDING_SANDBOX_MIGRATION_CODE = "FUNDING_SANDBOX_MIGRATION_REQUIRED" as const;
export type FundingConfigurationCode =
  | typeof FUNDING_CONFIGURATION_CODE
  | typeof FUNDING_SANDBOX_MIGRATION_CODE;

export class FundingProviderConfigurationError extends Error {
  readonly code: FundingConfigurationCode;

  constructor(message: string, options?: ErrorOptions & { code?: FundingConfigurationCode }) {
    super(message, options);
    this.name = "FundingProviderConfigurationError";
    this.code = options?.code ?? FUNDING_CONFIGURATION_CODE;
  }
}

export class FundingProviderFetchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FundingProviderFetchError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;
export type FundingMode = "production" | "sandbox";

const LEGACY_MODE_MIGRATION = "FUNDING_SANDBOX is no longer supported; use COINBASE_ONRAMP_MODE or PEER_OFFRAMP_MODE instead.";

export function resolveFundingMode(
  manifest: FundingProviderManifest,
  direction: FundingDirection,
  env: Environment,
): FundingMode {
  if (Object.prototype.hasOwnProperty.call(env, "FUNDING_SANDBOX")) {
    throw new FundingProviderConfigurationError(LEGACY_MODE_MIGRATION, {
      code: FUNDING_SANDBOX_MIGRATION_CODE,
    });
  }
  const capability = manifest[direction];
  const modeEnv = capability?.modeEnv;
  if (!modeEnv) return "production";
  const value = env[modeEnv]?.trim();
  if (!value) return "production";
  if (value !== "sandbox") {
    throw new FundingProviderConfigurationError(`${modeEnv} must be exactly sandbox when set.`);
  }
  const supportsSandbox = direction === "onramp"
    ? manifest.onramp?.sandbox === true
    : Boolean(manifest.offramp?.sandbox);
  if (!supportsSandbox) {
    throw new FundingProviderConfigurationError(`${modeEnv} selects sandbox, but ${manifest.id} ${direction} does not declare sandbox support.`);
  }
  return "sandbox";
}

type ContextOptions = {
  manifest: FundingProviderManifest;
  region: ProviderContext["binding"]["region"];
  direction?: FundingDirection;
  paymentMethodId: string;
  env?: Environment;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  sandbox?: boolean;
};
const providerFetchImplementations = new WeakMap<typeof fetch, typeof fetch>();

export function providerFetchImplementation(providerFetch: typeof fetch): typeof fetch {
  return providerFetchImplementations.get(providerFetch) ?? providerFetch;
}

export function createProviderContext(options: ContextOptions & { direction: "offramp" }): OfframpContext;
export function createProviderContext(options: ContextOptions): ProviderContext;
export function createProviderContext(options: ContextOptions): ProviderContext | OfframpContext {
  const direction = options.direction ?? "onramp";
  const matchingBindings = options.manifest.bindings.flatMap((binding) => {
    if (binding.region !== options.region) return [];
    const directional = binding.directions[direction];
    const paymentMethod = directional?.paymentMethods.find(
      (candidate) => candidate.id === options.paymentMethodId,
    );
    return directional && paymentMethod ? [{ binding, directional, paymentMethod }] : [];
  });
  if (matchingBindings.length !== 1) {
    throw new FundingProviderConfigurationError(
      "The requested funding provider binding is missing or ambiguous.",
    );
  }
  const { binding, directional, paymentMethod } = matchingBindings[0];

  const asset = getFundingAsset(binding.assetId);
  if (!asset || asset.chainId !== 8453) {
    throw new FundingProviderConfigurationError(
      "The funding provider binding references an unknown Base asset.",
    );
  }

  const selectedCapability = capabilityFor(options.manifest, direction, options.sandbox === true);
  const source = options.env ?? process.env;
  const declaredEnvironment: Record<string, string> = {};
  for (const name of directional.env) {
    const value = source[name]?.trim();
    if (!environmentAvailable([name], source)) {
      throw new FundingProviderConfigurationError(
        `The funding provider is missing required environment variable ${name}.`,
      );
    }
    declaredEnvironment[name] = value!;
  }

  const timeoutMs = options.timeoutMs ?? PROVIDER_FETCH_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new FundingProviderConfigurationError(
      "The funding provider timeout must be between 1 and 30000ms.",
    );
  }
  const allowedOrigins = normalizeOrigins(selectedCapability.apiOrigins);
  const fetchImplementation = options.fetchImplementation ?? fetch;

  const boundedFetch = (async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = requestUrl(input);
    if (!allowedOrigins.has(url.origin)) {
      throw new FundingProviderFetchError(
        `Funding provider origin ${url.origin} is not allowed.`,
      );
    }

    const controller = new AbortController();
    let interrupted = false;
    let rejectInterruption: (error: FundingProviderFetchError) => void = () => undefined;
    const interruption = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject;
    });
    const interrupt = (message: string, cause?: unknown) => {
      if (interrupted) return;
      interrupted = true;
      controller.abort(cause);
      rejectInterruption(new FundingProviderFetchError(message, { cause }));
    };
    const timeout = setTimeout(
      () => interrupt("The funding provider request timed out."),
      timeoutMs,
    );
    const externalSignal = init.signal;
    const abortFromExternal = () => interrupt(
      "The funding provider request was aborted.",
      externalSignal?.reason,
    );
    if (externalSignal?.aborted) {
      clearTimeout(timeout);
      throw new FundingProviderFetchError(
        "The funding provider request was already aborted.",
        { cause: externalSignal.reason },
      );
    }
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

    try {
      return await Promise.race([
        fetchImplementation(input, {
          ...init,
          redirect: "manual",
          signal: controller.signal,
        }),
        interruption,
      ]);
    } catch (error) {
      if (error instanceof FundingProviderFetchError) throw error;
      throw new FundingProviderFetchError(
        "The funding provider request failed.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }) as typeof fetch;

  providerFetchImplementations.set(boundedFetch, fetchImplementation);
  const common = {
    binding: Object.freeze({
      region: binding.region,
      direction,
      currency: binding.currency,
      asset,
      paymentMethod: Object.freeze({ ...paymentMethod }),
      paymentMethods: Object.freeze(directional.paymentMethods.map((method) => Object.freeze({ ...method }))),
    }),
    env: Object.freeze(declaredEnvironment),
    sandbox: options.sandbox === true,
    fetch: boundedFetch,
  };
  return Object.freeze(
    direction === "offramp"
      ? { ...common, deployment: selectedCapability.deployment }
      : common,
  ) as ProviderContext | OfframpContext;
}

function capabilityFor(
  manifest: FundingProviderManifest,
  direction: FundingDirection,
  sandbox: boolean,
): { apiOrigins: ReadonlyArray<string>; deployment?: FundingOfframpDeployment } {
  if (direction === "onramp") {
    const capability = manifest.onramp;
    if (!capability || (sandbox && capability.sandbox !== true)) {
      throw new FundingProviderConfigurationError(
        "The funding provider direction is unavailable in the selected mode.",
      );
    }
    return { apiOrigins: capability.apiOrigins };
  }
  const deployment = sandbox ? manifest.offramp?.sandbox : manifest.offramp?.production;
  if (!deployment) {
    throw new FundingProviderConfigurationError(
      "The funding provider direction is unavailable in the selected mode.",
    );
  }
  return { apiOrigins: deployment.apiOrigins, deployment };
}

export function resolveWebhookEnvironment(
  webhook: FundingWebhookManifest,
  region: ProviderContext["binding"]["region"],
): string | undefined {
  return typeof webhook.env === "string" ? webhook.env : webhook.env[region];
}

export function environmentAvailable(names: ReadonlyArray<string>, env: Environment): boolean {
  return names.every((name) => {
    const value = env[name]?.trim();
    return name.endsWith("_ENABLED") ? value === "1" : Boolean(value);
  });
}

export function normalizeFundingOrigins(origins: ReadonlyArray<string>): ReadonlySet<string> {
  return normalizeOrigins(origins);
}

function normalizeOrigins(origins: ReadonlyArray<string>): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch (error) {
      throw new FundingProviderConfigurationError(
        `Funding provider API origin ${origin} is invalid.`,
        { cause: error },
      );
    }
    if (
      url.origin !== origin ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && url.hostname !== "localhost")
    ) {
      throw new FundingProviderConfigurationError(
        `Funding provider API origin ${origin} must be a bare HTTPS origin.`,
      );
    }
    if (normalized.has(url.origin)) {
      throw new FundingProviderConfigurationError(
        `Funding provider API origin ${origin} is duplicated.`,
      );
    }
    normalized.add(url.origin);
  }
  if (normalized.size === 0) {
    throw new FundingProviderConfigurationError(
      "The funding provider must declare at least one API origin.",
    );
  }
  return normalized;
}

function requestUrl(input: RequestInfo | URL): URL {
  try {
    return new URL(input instanceof Request ? input.url : String(input));
  } catch (error) {
    throw new FundingProviderFetchError("The funding provider request URL is invalid.", {
      cause: error,
    });
  }
}
