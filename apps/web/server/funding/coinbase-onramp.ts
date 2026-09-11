import "server-only";

import { generateJwt } from "@coinbase/cdp-sdk/auth";
import {
  FUNDING_BASE_CHAIN_ID,
  FUNDING_BASE_USDC_ADDRESS,
  type HostedOnrampSession,
} from "@/shared/funding/types";
import { parseCoinbaseHostedUrl } from "@/shared/funding/funding-client";

const ONRAMP_HOST = "api.cdp.coinbase.com";
const ONRAMP_PATH = "/platform/v2/onramp/sessions";
const ONRAMP_URL = `https://${ONRAMP_HOST}${ONRAMP_PATH}`;

export class CoinbaseOnrampError extends Error {
  readonly code: "not-configured" | "unavailable" | "invalid-response";

  constructor(code: CoinbaseOnrampError["code"], cause?: unknown) {
    super(code, { cause });
    this.name = "CoinbaseOnrampError";
    this.code = code;
  }
}

export type CreateCoinbaseOnrampSession = (options: {
  address: `0x${string}`;
  redirectUrl: string;
  signal?: AbortSignal;
}) => Promise<HostedOnrampSession>;

type Environment = Record<string, string | undefined>;
type JwtGenerator = typeof generateJwt;
type OnrampFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createCoinbaseOnrampClient(options: {
  env?: Environment;
  fetchImplementation?: OnrampFetch;
  generateJwtImplementation?: JwtGenerator;
} = {}): CreateCoinbaseOnrampSession {
  const env = options.env ?? process.env;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const generateJwtImplementation = options.generateJwtImplementation ?? generateJwt;

  return async ({ address, redirectUrl, signal }) => {
    const apiKeyId = env.CDP_API_KEY_ID?.trim();
    const apiKeySecret = env.CDP_API_KEY_SECRET?.trim();
    if (!apiKeyId || !apiKeySecret) {
      throw new CoinbaseOnrampError("not-configured");
    }

    let token: string;
    try {
      token = await generateJwtImplementation({
        apiKeyId,
        apiKeySecret,
        requestMethod: "POST",
        requestHost: ONRAMP_HOST,
        requestPath: ONRAMP_PATH,
        expiresIn: 120,
      });
    } catch (error) {
      throw new CoinbaseOnrampError("not-configured", error);
    }

    let response: Response;
    try {
      response = await fetchImplementation(ONRAMP_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purchaseCurrency: "USDC",
          destinationNetwork: "base",
          destinationAddress: address,
          redirectUrl,
        }),
        cache: "no-store",
        signal,
      });
    } catch (error) {
      throw new CoinbaseOnrampError("unavailable", error);
    }

    if (!response.ok) {
      throw new CoinbaseOnrampError("unavailable");
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new CoinbaseOnrampError("invalid-response", error);
    }
    if (!isRecord(value) || !isRecord(value.session)) {
      throw new CoinbaseOnrampError("invalid-response");
    }

    let url: string;
    try {
      url = parseCoinbaseHostedUrl(value.session.onrampUrl);
    } catch (error) {
      throw new CoinbaseOnrampError("invalid-response", error);
    }

    return {
      url,
      asset: {
        id: "usdc",
        symbol: "USDC",
        decimals: 6,
        tokenAddress: FUNDING_BASE_USDC_ADDRESS,
      },
      network: { name: "Base", chainId: FUNDING_BASE_CHAIN_ID },
    };
  };
}

export const createCoinbaseHostedOnrampSession = createCoinbaseOnrampClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
