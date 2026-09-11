import "server-only";

import type { RipioClient, RipioTransactionReference } from "./ripio-client";
import type { RipioReconciliationStore } from "./ripio-reconciliation";

export async function reconcilePendingRipioInbox(dependencies: {
  store: RipioReconciliationStore;
  clientForCountry: (country: "AR" | "CO") => RipioClient;
  now?: () => string;
  limit?: number;
}): Promise<{ reconciled: number; stillPending: number }> {
  const pending = await dependencies.store.listPendingInbox(dependencies.limit ?? 25);
  let reconciled = 0;
  for (const item of pending) {
    const matches: Array<{ country: "AR" | "CO"; transaction: RipioTransactionReference }> = [];
    for (const country of ["AR", "CO"] as const) {
      try {
        const transaction = await dependencies.clientForCountry(country).getTransaction(item.providerOrderId);
        if (transaction.transactionId === item.providerOrderId) matches.push({ country, transaction });
      } catch {
        // A country-scoped 404/unavailable response leaves the durable inbox retryable.
      }
    }
    if (matches.length !== 1) continue;
    const result = await dependencies.store.resolveInbox({
      eventId: item.eventId,
      country: matches[0].country,
      transaction: matches[0].transaction,
      resolvedAt: dependencies.now?.() ?? new Date().toISOString(),
    });
    if (result === "applied") reconciled += 1;
  }
  return { reconciled, stillPending: pending.length - reconciled };
}
