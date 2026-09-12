import { getFundingAsset } from "@/shared/funding/assets";
import type {
  FundingProviderManifest,
  ProviderContext,
} from "@/shared/funding/provider-contract";

export const PROVIDER_FETCH_TIMEOUT_MS = 6_000;

export class FundingProviderConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FundingProviderConfigurationError";
  }
}

export class FundingProviderFetchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FundingProviderFetchError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

export function createProviderContext(options: {
  manifest: FundingProviderManifest;
  region: ProviderContext["binding"]["region"];
  paymentMethodId: string;
  env?: Environment;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}): ProviderContext {
  const matchingBindings = options.manifest.bindings.flatMap((binding) => {
    if (binding.region !== options.region) return [];
    const paymentMethod = binding.paymentMethods.find(
      (candidate) => candidate.id === options.paymentMethodId,
    );
    return paymentMethod ? [{ binding, paymentMethod }] : [];
  });
  if (matchingBindings.length !== 1) {
    throw new FundingProviderConfigurationError(
      "The requested funding provider binding is missing or ambiguous.",
    );
  }
  const { binding, paymentMethod } = matchingBindings[0];

  const asset = getFundingAsset(binding.assetId);
  if (!asset || asset.chainId !== 8453) {
    throw new FundingProviderConfigurationError(
      "The funding provider binding references an unknown Base asset.",
    );
  }

  const source = options.env ?? process.env;
  const declaredEnvironment: Record<string, string> = {};
  for (const name of binding.env) {
    const value = source[name]?.trim();
    if (!value) {
      throw new FundingProviderConfigurationError(
        `The funding provider is missing required environment variable ${name}.`,
      );
    }
    declaredEnvironment[name] = value;
  }

  const timeoutMs = options.timeoutMs ?? PROVIDER_FETCH_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new FundingProviderConfigurationError(
      "The funding provider timeout must be between 1 and 30000ms.",
    );
  }
  const allowedOrigins = normalizeOrigins(options.manifest.apiOrigins);
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

  return Object.freeze({
    binding: Object.freeze({
      region: binding.region,
      asset,
      paymentMethod: Object.freeze({ ...paymentMethod }),
    }),
    env: Object.freeze(declaredEnvironment),
    fetch: boundedFetch,
  });
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
