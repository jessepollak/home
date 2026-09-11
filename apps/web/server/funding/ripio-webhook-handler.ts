import "server-only";

import { createHash } from "node:crypto";
import type { RipioBaseTransferEvidence } from "@/shared/funding/ripio-contract";
import { RipioProviderError, type RipioClient } from "./ripio-client";
import {
  parseRipioWebhook,
  transactionMatchesOrder,
  verifyRipioWebhook,
  type RipioReconciliationStore,
} from "./ripio-reconciliation";

const RIPIO_SIGNATURE_HEADER = "http-x-wh-signature-256";

function atomicToDecimal(value: string, decimals: number): string {
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function createRipioWebhookHandler(dependencies: {
  signingKey: string;
  store: RipioReconciliationStore;
  clientForCountry: (country: "AR" | "CO") => RipioClient;
  findBaseTransferEvidence: (input: {
    transactionHash: `0x${string}`;
    destination: `0x${string}`;
    tokenAddress: `0x${string}`;
  }) => Promise<RipioBaseTransferEvidence | null>;
  now?: () => string;
}) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return async function POST(request: Request): Promise<Response> {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    const signature = request.headers.get(RIPIO_SIGNATURE_HEADER);
    if (!verifyRipioWebhook({ rawBody, signature, signingKey: dependencies.signingKey })) {
      return Response.json({ error: "invalid-signature" }, { status: 401 });
    }
    const event = parseRipioWebhook(rawBody);
    if (!event) return Response.json({ error: "invalid-event" }, { status: 400 });
    const digest = createHash("sha256").update(rawBody).digest("hex");
    const duplicate = await dependencies.store.hasWebhookEvent(event.eventId);
    const order = await dependencies.store.getByProviderOrderId(event.providerOrderId);
    if (duplicate && (!order || order.state !== "sent-unverified")) {
      return Response.json({ accepted: true, duplicate: true }, { status: 202 });
    }
    if (!order) {
      const recorded = await dependencies.store.recordUnmatchedWebhook({
        event,
        rawBodyDigest: digest,
        state: "pending-recovery",
        recordedAt: now(),
      });
      return Response.json({ accepted: true, duplicate: !recorded, matched: false, recovery: "pending" }, { status: 202 });
    }

    let transaction;
    try {
      transaction = await dependencies.clientForCountry(order.country).getTransaction(order.providerOrderId, {
        customerId: order.customerId,
        quoteId: order.quoteId,
        externalRef: order.homeOrderId,
        destination: order.destination,
        fromCurrency: order.fromCurrency,
        toCurrency: order.toCurrency,
        chain: order.chain,
        paymentMethodType: order.paymentMethodType,
        finalToAmount: atomicToDecimal(order.expectedAmountAtomic, order.tokenDecimals),
      });
    } catch (error) {
      if (error instanceof RipioProviderError && error.code === "binding-conflict") {
        return Response.json({ error: "binding-conflict" }, { status: 409 });
      }
      return Response.json({ error: "reconciliation-unavailable" }, { status: 503 });
    }
    if (!transactionMatchesOrder(order, transaction)) {
      return Response.json({ error: "binding-conflict" }, { status: 409 });
    }
    let evidence: RipioBaseTransferEvidence | null = null;
    if (transaction.txnHash) {
      evidence = await dependencies.findBaseTransferEvidence({
        transactionHash: transaction.txnHash as `0x${string}`,
        destination: order.destination,
        tokenAddress: order.tokenAddress,
      });
    }
    const result = await dependencies.store.applyVerifiedObservation({
      event,
      rawBodyDigest: digest,
      transaction,
      transferEvidence: evidence,
      observedAt: now(),
    });
    if (result === "binding-conflict") return Response.json({ error: "binding-conflict" }, { status: 409 });
    if (result === "unmatched") return Response.json({ error: "order-raced" }, { status: 503 });
    return Response.json({ accepted: true, duplicate: result === "duplicate", matched: true }, { status: 202 });
  };
}
