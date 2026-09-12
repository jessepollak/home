import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type {
  FundingProvider,
  OrderIntent,
  ProviderContext,
} from "@/shared/funding/provider-contract";
import {
  COINBASE_ONRAMP_API_ORIGIN,
  COINBASE_ONRAMP_REDIRECT_ORIGIN,
  coinbaseManifest,
} from "./manifest";

const ONRAMP_HOST = "api.cdp.coinbase.com";
const ONRAMP_PATH = "/platform/v2/onramp/sessions";
const ONRAMP_URL = `${COINBASE_ONRAMP_API_ORIGIN}${ONRAMP_PATH}`;

type JwtGenerator = typeof generateJwt;

type CoinbaseProviderOptions = {
  generateJwtImplementation?: JwtGenerator;
};

export function createCoinbaseProvider(
  options: CoinbaseProviderOptions = {},
): FundingProvider {
  const generateJwtImplementation = options.generateJwtImplementation ?? generateJwt;

  return {
    manifest: coinbaseManifest,

    async createOrder(input, ctx) {
      if (
        !input.quote ||
        input.quote.fiatAmount !== input.fiatAmount ||
        !/^(?:0|[1-9]\d*)$/.test(input.quote.tokenAmountAtomic)
      ) {
        return {
          outcome: "rejected",
          message: "A current funding amount is required.",
        };
      }

      const hosted = await createHostedSession(
        input,
        ctx,
        generateJwtImplementation,
      );
      if (!hosted) return { outcome: "ambiguous" };

      return {
        outcome: "created",
        order: {
          providerOrderId: hosted.providerOrderId,
          tokenAddress: ctx.binding.asset.address,
          expectedTokenAmountAtomic: input.quote.tokenAmountAtomic,
          fees: [],
          expiresAt: null,
          instructions: { kind: "redirect", url: hosted.url },
        },
      };
    },

    async getOrder() {
      // CDP transaction-status reconciliation remains tracked in #52.
      return { state: "unknown", providerStatus: "STATUS_UNAVAILABLE" };
    },
  };
}

export const coinbaseProvider = createCoinbaseProvider();

async function createHostedSession(
  input: OrderIntent,
  ctx: ProviderContext,
  generateJwtImplementation: JwtGenerator,
): Promise<{ providerOrderId: string; url: string } | null> {
  const apiKeyId = ctx.env.CDP_API_KEY_ID?.trim();
  const apiKeySecret = ctx.env.CDP_API_KEY_SECRET?.trim();
  if (!apiKeyId || !apiKeySecret) return null;

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
  } catch {
    return null;
  }

  let response: Response;
  try {
    response = await ctx.fetch(ONRAMP_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        purchaseCurrency: "USDC",
        destinationNetwork: "base",
        destinationAddress: input.destination,
        redirectUrl: coinbaseReturnUrl(input.returnUrl),
      }),
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.session)) return null;

  try {
    return parseHostedSession(value.session.onrampUrl);
  } catch {
    return null;
  }
}

function coinbaseReturnUrl(value: string): string {
  const url = new URL(value);
  url.pathname = "/fund";
  url.search = "?return=coinbase";
  url.hash = "";
  return url.toString();
}

function parseHostedSession(
  value: unknown,
): { providerOrderId: string; url: string } {
  if (typeof value !== "string" || value.length > 4096) {
    throw new Error("Invalid Coinbase hosted URL.");
  }
  const url = new URL(value);
  const providerOrderId = url.searchParams.get("sessionToken");
  if (
    url.protocol !== "https:" ||
    url.origin !== COINBASE_ONRAMP_REDIRECT_ORIGIN ||
    (url.pathname !== "/buy" && url.pathname !== "/buy/select-asset") ||
    !providerOrderId ||
    providerOrderId.length > 4096 ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Invalid Coinbase hosted URL.");
  }
  return { providerOrderId, url: url.toString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
