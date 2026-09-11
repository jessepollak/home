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
  order: Pick<DurableRipioOrder, "customerId" | "quoteId" | "homeOrderId" | "destination">;
}): {
  customerId: string;
  quoteId: string;
  externalRef: string;
  destination: `0x${string}`;
} {
  return {
    customerId: input.order.customerId,
    quoteId: input.order.quoteId,
    externalRef: input.order.homeOrderId,
    destination: input.order.destination,
  };
}
