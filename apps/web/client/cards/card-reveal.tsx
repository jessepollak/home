"use client";

import { useEffect, useRef, useState } from "react";
import type { StripeElementStyle } from "@stripe/stripe-js";
import { LoadErrorCard } from "@/components/load-error";
import { reportClientError } from "@/client/observability/client-reporter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CardCommands } from "./use-cards";

export function stripePublishableKey(value = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY): string | null {
  const key = value?.trim();
  return key && /^pk_(test|live)_[A-Za-z0-9]+$/.test(key) ? key : null;
}

type RevealState = "loading" | "ready" | "failed";

export function CardDetailsReveal({ cardId, publishableKey, revealKey }: {
  cardId: string;
  publishableKey: string;
  revealKey: CardCommands["revealKey"];
}) {
  const numberRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLDivElement>(null);
  const cvcRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RevealState>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const mounted: { destroy: () => void }[] = [];
    void (async () => {
      try {
        const { loadStripe } = await import("@stripe/stripe-js/pure");
        const stripe = await loadStripe(publishableKey);
        if (!stripe) throw new Error("Stripe unavailable");
        if (cancelled) return;
        const prepared = await revealKey(cardId, { method: "stripe-issuing-elements", step: "prepare" });
        if (cancelled) return;
        if (prepared.grant.method !== "stripe-issuing-elements" || prepared.grant.step !== "prepare") throw new Error("Unsupported reveal method");
        const nonceResult = await stripe.createEphemeralKeyNonce({ issuingCard: prepared.grant.issuingCard });
        if (cancelled) return;
        if (!nonceResult.nonce) throw new Error("Nonce unavailable");
        const response = await revealKey(cardId, { method: "stripe-issuing-elements", step: "grant", nonce: nonceResult.nonce });
        if (response.grant.method !== "stripe-issuing-elements" || response.grant.step !== "grant" || response.grant.issuingCard !== prepared.grant.issuingCard)
          throw new Error("Invalid reveal grant");
        const { ephemeralKeySecret, issuingCard, nonce } = response.grant;
        if (cancelled || !numberRef.current || !expiryRef.current || !cvcRef.current) return;
        const computed = getComputedStyle(numberRef.current);
        const style: StripeElementStyle = {
          base: { color: computed.color, fontSize: "16px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
        };
        const options = { issuingCard, nonce, ephemeralKeySecret, style };
        const elements = stripe.elements();
        const number = elements.create("issuingCardNumberDisplay", options);
        const expiry = elements.create("issuingCardExpiryDisplay", options);
        const cvc = elements.create("issuingCardCvcDisplay", options);
        number.mount(numberRef.current);
        expiry.mount(expiryRef.current);
        cvc.mount(cvcRef.current);
        mounted.push(number, expiry, cvc);
        setState("ready");
      } catch (error) {
        if (!cancelled) setState("failed");
        void reportClientError({
          name: error instanceof Error ? error.name : "Error",
          message: "Card details reveal failed",
          route: window.location.pathname,
        });
      }
    })();
    return () => {
      cancelled = true;
      for (const element of mounted) element.destroy();
    };
  }, [attempt, cardId, publishableKey, revealKey]);

  if (state === "failed") {
    return (
      <LoadErrorCard
        description="Couldn't show card details."
        onRetry={() => { setState("loading"); setAttempt((value) => value + 1); }}
      />
    );
  }
  return (
    <Card variant="flush" aria-busy={state === "loading" || undefined}>
      <CardContent inset="list">
        <dl>
          {([["Card number", numberRef], ["Expires", expiryRef], ["CVV", cvcRef]] as const).map(([label, ref]) => (
            <div key={label} className="flex min-h-11 items-center justify-between gap-3 px-3 py-3 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="relative min-w-0 flex-1 text-right text-foreground">
                {state === "loading" ? <Skeleton className="ms-auto h-5 w-24" /> : null}
                <div ref={ref} hidden={state === "loading"} />
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
