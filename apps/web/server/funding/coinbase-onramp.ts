import { generateJwt } from "@coinbase/cdp-sdk/auth";
import {
  FUNDING_BASE_CHAIN_ID,
  FUNDING_BASE_USDC_ADDRESS,
  type HostedOnrampSession,
  type OnrampPaymentMethod,
} from "@/features/funding/types";
import {
  parseCoinbaseHostedUrl,
  parseCoinbasePaymentLinkUrl,
} from "@/features/funding/funding-client";

const ONRAMP_HOST = "api.cdp.coinbase.com";
const SESSION_PATH = "/platform/v2/onramp/sessions";
// Headless Apple Pay / Google Pay payment links come from the orders API.
const ORDER_PATH = "/platform/v2/onramp/orders";

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
  domain: string;
  partnerUserRef: string;
  paymentMethod: OnrampPaymentMethod;
  paymentAmount: string;
  clientIp?: string;
  signal?: AbortSignal;
}) => Promise<HostedOnrampSession>;

type Environment = Record<string, string | undefined>;
type JwtGenerator = typeof generateJwt;
type OnrampFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const ONRAMP_ASSET = {
  id: "usdc",
  symbol: "USDC",
  decimals: 6,
  tokenAddress: FUNDING_BASE_USDC_ADDRESS,
} as const;

const ONRAMP_NETWORK = { name: "Base", chainId: FUNDING_BASE_CHAIN_ID } as const;

export function createCoinbaseOnrampClient(options: {
  env?: Environment;
  fetchImplementation?: OnrampFetch;
  generateJwtImplementation?: JwtGenerator;
} = {}): CreateCoinbaseOnrampSession {
  const env = options.env ?? process.env;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const generateJwtImplementation = options.generateJwtImplementation ?? generateJwt;

  return async (request) => {
    const credentials = readCredentials(env);
    try {
      return await createHeadlessPaymentLink({
        credentials,
        env,
        fetchImplementation,
        generateJwtImplementation,
        request,
      });
    } catch (error) {
      if (
        error instanceof CoinbaseOnrampError &&
        error.code === "unavailable" &&
        !isOnrampSandbox(env)
      ) {
        return createHostedOnrampSession({
          credentials,
          fetchImplementation,
          generateJwtImplementation,
          request,
        });
      }
      throw error;
    }
  };
}

export const createCoinbaseHostedOnrampSession = createCoinbaseOnrampClient();

async function createHeadlessPaymentLink(options: {
  credentials: CoinbaseCredentials;
  env: Environment;
  fetchImplementation: OnrampFetch;
  generateJwtImplementation: JwtGenerator;
  request: Parameters<CreateCoinbaseOnrampSession>[0];
}): Promise<HostedOnrampSession> {
  const paymentMethod = options.request.paymentMethod;
  const sandbox = isOnrampSandbox(options.env);
  const value = await postCoinbaseJson({
    credentials: options.credentials,
    fetchImplementation: options.fetchImplementation,
    generateJwtImplementation: options.generateJwtImplementation,
    path: ORDER_PATH,
    signal: options.request.signal,
    body: {
      purchaseCurrency: "USDC",
      paymentCurrency: "USD",
      paymentAmount: options.request.paymentAmount,
      paymentMethod:
        paymentMethod === "google-pay"
          ? "GUEST_CHECKOUT_GOOGLE_PAY"
          : "GUEST_CHECKOUT_APPLE_PAY",
      destinationNetwork: "base",
      destinationAddress: options.request.address,
      partnerUserRef: sandboxPartnerRef(options.request.partnerUserRef, sandbox),
      domain: options.request.domain,
      ...(options.request.clientIp ? { clientIp: options.request.clientIp } : {}),
    },
  });

  const paymentLink = isRecord(value)
    ? readPaymentLinkUrl(value.paymentLink)
    : undefined;
  let url: string;
  try {
    url = parseCoinbasePaymentLinkUrl(paymentLink);
  } catch (error) {
    throw new CoinbaseOnrampError("invalid-response", error);
  }
  if (sandbox) {
    url = withSandboxPaymentQuery(url, paymentMethod);
  }
  return { url, presentation: "iframe", asset: ONRAMP_ASSET, network: ONRAMP_NETWORK };
}

async function createHostedOnrampSession(options: {
  credentials: CoinbaseCredentials;
  fetchImplementation: OnrampFetch;
  generateJwtImplementation: JwtGenerator;
  request: Parameters<CreateCoinbaseOnrampSession>[0];
}): Promise<HostedOnrampSession> {
  const value = await postCoinbaseJson({
    credentials: options.credentials,
    fetchImplementation: options.fetchImplementation,
    generateJwtImplementation: options.generateJwtImplementation,
    path: SESSION_PATH,
    signal: options.request.signal,
    body: {
      purchaseCurrency: "USDC",
      destinationNetwork: "base",
      destinationAddress: options.request.address,
      redirectUrl: options.request.redirectUrl,
    },
  });
  if (!isRecord(value) || !isRecord(value.session)) {
    throw new CoinbaseOnrampError("invalid-response");
  }

  let url: string;
  try {
    url = parseCoinbaseHostedUrl(value.session.onrampUrl);
  } catch (error) {
    throw new CoinbaseOnrampError("invalid-response", error);
  }
  return { url, presentation: "hosted", asset: ONRAMP_ASSET, network: ONRAMP_NETWORK };
}

async function postCoinbaseJson(options: {
  credentials: CoinbaseCredentials;
  fetchImplementation: OnrampFetch;
  generateJwtImplementation: JwtGenerator;
  path: typeof ORDER_PATH | typeof SESSION_PATH;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<unknown> {
  let token: string;
  try {
    token = await options.generateJwtImplementation({
      apiKeyId: options.credentials.apiKeyId,
      apiKeySecret: options.credentials.apiKeySecret,
      requestMethod: "POST",
      requestHost: ONRAMP_HOST,
      requestPath: options.path,
      expiresIn: 120,
    });
  } catch (error) {
    throw new CoinbaseOnrampError("not-configured", error);
  }

  let response: Response;
  try {
    response = await options.fetchImplementation(`https://${ONRAMP_HOST}${options.path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options.body),
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    throw new CoinbaseOnrampError("unavailable", error);
  }

  if (!response.ok) {
    throw new CoinbaseOnrampError("unavailable");
  }

  try {
    return await response.json();
  } catch (error) {
    throw new CoinbaseOnrampError("invalid-response", error);
  }
}

type CoinbaseCredentials = { apiKeyId: string; apiKeySecret: string };

function readCredentials(env: Environment): CoinbaseCredentials {
  const apiKeyId = env.CDP_API_KEY_ID?.trim();
  const apiKeySecret = env.CDP_API_KEY_SECRET?.trim();
  if (!apiKeyId || !apiKeySecret) {
    throw new CoinbaseOnrampError("not-configured");
  }
  return { apiKeyId, apiKeySecret };
}

export function isOnrampSandbox(env: Environment = process.env): boolean {
  if (env.VERCEL_ENV === "preview") return true;
  const explicit = env.CDP_ONRAMP_SANDBOX?.trim();
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  // Next.js production builds set NODE_ENV=production on Vercel Preview and
  // `next start`. Live payments only on an explicit production deploy.
  return env.VERCEL_ENV !== "production";
}

function sandboxPartnerRef(value: string, sandbox: boolean): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 64) || "user";
  return sandbox && !cleaned.startsWith("sandbox-") ? `sandbox-${cleaned}` : cleaned;
}

function withSandboxPaymentQuery(url: string, paymentMethod: OnrampPaymentMethod): string {
  const parsed = new URL(url);
  parsed.searchParams.set(
    paymentMethod === "google-pay" ? "useGooglePaySandbox" : "useApplePaySandbox",
    "true",
  );
  return parseCoinbasePaymentLinkUrl(parsed.toString());
}

function readPaymentLinkUrl(value: unknown): unknown {
  if (typeof value === "string") return value;
  return isRecord(value) ? value.url : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
