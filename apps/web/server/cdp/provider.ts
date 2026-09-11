import "server-only";

import {
  AuthUnavailableError,
  InvalidAccessTokenError,
  type AccessTokenValidator,
} from "./session";

type CdpEndUserClient = {
  validateAccessToken(options: { accessToken: string }): Promise<unknown>;
};

type CdpClientLike = {
  endUser: CdpEndUserClient;
};

type CdpSdkModule = {
  CdpClient: new (options: { apiKeyId: string; apiKeySecret: string }) => CdpClientLike;
};

type CdpEnvironment = Record<string, string | undefined>;

type CreateValidatorOptions = {
  env?: CdpEnvironment;
  loadSdk?: () => Promise<CdpSdkModule>;
};

type ProviderError = {
  statusCode?: unknown;
  errorType?: unknown;
};

function isInvalidTokenProviderError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const providerError = error as ProviderError;
  return providerError.statusCode === 400 || providerError.statusCode === 401;
}

export class CdpSdkAccessTokenValidator implements AccessTokenValidator {
  constructor(private readonly client: CdpClientLike) {}

  async validateAccessToken(accessToken: string): Promise<unknown> {
    try {
      return await this.client.endUser.validateAccessToken({ accessToken });
    } catch (error) {
      if (isInvalidTokenProviderError(error)) {
        throw new InvalidAccessTokenError();
      }

      throw new AuthUnavailableError(error);
    }
  }
}

async function loadCdpSdk(): Promise<CdpSdkModule> {
  return import("@coinbase/cdp-sdk");
}

function applyCdpTelemetryDefaults(env: CdpEnvironment): void {
  if (env.DISABLE_CDP_USAGE_TRACKING !== "false") {
    env.DISABLE_CDP_USAGE_TRACKING = "true";
  }
  if (env.DISABLE_CDP_ERROR_REPORTING !== "false") {
    env.DISABLE_CDP_ERROR_REPORTING = "true";
  }
}

export async function createCdpAccessTokenValidator({
  env = process.env,
  loadSdk = loadCdpSdk,
}: CreateValidatorOptions = {}): Promise<AccessTokenValidator> {
  const apiKeyId = env.CDP_API_KEY_ID;
  const apiKeySecret = env.CDP_API_KEY_SECRET;

  if (!apiKeyId?.trim() || !apiKeySecret?.trim()) {
    throw new AuthUnavailableError();
  }

  try {
    applyCdpTelemetryDefaults(env);
    const { CdpClient } = await loadSdk();
    const client = new CdpClient({
      apiKeyId,
      apiKeySecret,
    });

    return new CdpSdkAccessTokenValidator(client);
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      throw error;
    }

    throw new AuthUnavailableError(error);
  }
}

let defaultValidatorPromise: Promise<AccessTokenValidator> | undefined;

export function getCdpAccessTokenValidator(): Promise<AccessTokenValidator> {
  if (!defaultValidatorPromise) {
    defaultValidatorPromise = createCdpAccessTokenValidator().catch((error) => {
      defaultValidatorPromise = undefined;
      throw error;
    });
  }

  return defaultValidatorPromise;
}
