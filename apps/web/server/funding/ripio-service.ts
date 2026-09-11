import "server-only";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  RIPIO_ASSETS,
  type RipioEnabledCountry,
  type RipioPaymentMethod,
  type RipioQuoteRequest,
} from "@/shared/funding/ripio-contract";
import type { DurableRipioOrder } from "./ripio-reconciliation";

export function serverBoundRipioQuote(input: {
  session: VerifiedAccountSession;
  country: RipioEnabledCountry;
  fromAmount: string;
  paymentMethodType: RipioPaymentMethod;
}): RipioQuoteRequest {
  const account = input.session.smartAccount;
  if (!account || account.chainId !== 8453) throw new Error("verified-base-account-required");
  const asset = RIPIO_ASSETS[input.country];
  return {
    country: input.country,
    fromCurrency: asset.fiatCurrency,
    toCurrency: asset.token,
    fromAmount: input.fromAmount,
    chain: "BASE",
    paymentMethodType: input.paymentMethodType,
    destination: account.address.toLowerCase() as `0x${string}`,
  };
}

export function serverBoundRipioOrder(input: {
  order: Pick<DurableRipioOrder, "customerId" | "quoteId" | "homeOrderId" | "destination" | "fromCurrency" | "toCurrency" | "chain" | "paymentMethodType" | "expectedAmountAtomic" | "tokenDecimals">;
}): {
  customerId: string;
  quoteId: string;
  externalRef: string;
  destination: `0x${string}`;
  fromCurrency: string;
  toCurrency: string;
  chain: "BASE";
  paymentMethodType: string;
  finalToAmount: string;
} {
  return {
    customerId: input.order.customerId,
    quoteId: input.order.quoteId,
    externalRef: input.order.homeOrderId,
    destination: input.order.destination,
    fromCurrency: input.order.fromCurrency,
    toCurrency: input.order.toCurrency,
    chain: input.order.chain,
    paymentMethodType: input.order.paymentMethodType,
    finalToAmount: atomicToDecimal(input.order.expectedAmountAtomic, input.order.tokenDecimals),
  };
}

function atomicToDecimal(value: string, decimals: number): string {
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
