import "server-only";

import { createHash } from "node:crypto";
import type { RipioBaseTransferEvidence } from "@/shared/funding/ripio-contract";
import type { RipioClient } from "./ripio-client";
import {
  parseRipioWebhook,
  reconcileRipioOrder,
  verifyRipioWebhook,
  type RipioReconciliationStore,
} from "./ripio-reconciliation";

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
    const signature = request.headers.get("x-ripio-signature");
    if (!verifyRipioWebhook({ rawBody, signature, signingKey: dependencies.signingKey })) {
      return Response.json({ error: "invalid-signature" }, { status: 401 });
    }
    const event = parseRipioWebhook(rawBody);
    if (!event) return Response.json({ error: "invalid-event" }, { status: 400 });
    const digest = createHash("sha256").update(rawBody).digest("hex");
    if (await dependencies.store.hasWebhookEvent(event.eventId)) {
      return Response.json({ accepted: true, duplicate: true }, { status: 202 });
    }
    const order = await dependencies.store.getByProviderOrderId(event.providerOrderId);
    if (!order) {
      const recorded = await dependencies.store.recordWebhookEvent(event, digest);
      return Response.json({ accepted: true, duplicate: !recorded, matched: false }, { status: 202 });
    }

    // Webhook payloads are notifications, not authoritative state. Re-read the
    // provider transaction and use its recorded ID/hash for reconciliation.
    let transaction;
    try {
      transaction = await dependencies.clientForCountry(order.country).getTransaction(order.providerOrderId);
    } catch {
      return Response.json({ error: "reconciliation-unavailable" }, { status: 503 });
    }
    let evidence: RipioBaseTransferEvidence | null = null;
    if (transaction.txnHash) {
      evidence = await dependencies.findBaseTransferEvidence({
        transactionHash: transaction.txnHash as `0x${string}`,
        destination: order.destination,
        tokenAddress: order.tokenAddress,
      });
    }
    const reconciled = reconcileRipioOrder({
      order,
      providerStatus: transaction.status,
      providerTransactionHash: transaction.txnHash,
      transferEvidence: evidence,
      now: now(),
    });
    const recorded = await dependencies.store.recordWebhookEvent(event, digest);
    if (recorded) await dependencies.store.saveReconciledOrder(reconciled);
    return Response.json({ accepted: true, duplicate: !recorded, matched: true }, { status: 202 });
  };
}
