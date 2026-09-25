import "server-only";

import { emitServerEvent } from "@/server/observability/log";
import type { FundingOrder, FundingOrderStore } from "@/server/funding/core/store";
import type { FundingProviderCustomer, FundingProviderCustomerStore } from "@/server/funding/core/customer-store";
import { fundingOrderEvents, verificationChangedEvent, type OperatorEventInput } from "./events";

type Recorder = (event: OperatorEventInput) => Promise<void>;

async function recordSafely(events: ReadonlyArray<OperatorEventInput>, record: Recorder): Promise<void> {
  try {
    for (const event of events) await record(event);
  } catch {
    emitServerEvent("operator-registry", { route: "/operator-registry", code: "OPERATOR_REGISTRY_WRITE_FAILED", outcome: "failed" });
  }
}

function orderEvents(order: FundingOrder | null, name: OperatorEventInput["name"]): OperatorEventInput[] {
  return order ? fundingOrderEvents(order).filter((event) => event.name === name) : [];
}

function customerEvents(customer: FundingProviderCustomer | null): OperatorEventInput[] {
  const event = customer ? verificationChangedEvent(customer) : null;
  return event ? [event] : [];
}

export function withFundingOrderEvents(store: FundingOrderStore, record: Recorder): FundingOrderStore {
  const finalized = async <T extends FundingOrder | null>(result: T): Promise<T> => {
    await recordSafely(orderEvents(result, "funding.order_finalized"), record);
    return result;
  };
  return {
    async reserve(input) {
      const result = await store.reserve(input);
      if (result.created) await recordSafely(orderEvents(result.order, "funding.order_created"), record);
      return result;
    },
    getOwned: (id, owner) => store.getOwned(id, owner),
    getByIntent: (owner, intentDigest) => store.getByIntent(owner, intentDigest),
    getOpen: (owner, region) => store.getOpen(owner, region),
    getDispatchAmbiguous: (owner, region, providerId) => store.getDispatchAmbiguous(owner, region, providerId),
    getByProviderOrderId: (providerId, providerOrderId) => store.getByProviderOrderId(providerId, providerOrderId),
    completeDispatch: async (id, input) => finalized(await store.completeDispatch(id, input)),
    markDispatchAmbiguous: async (id, expectedVersion, updatedAt) =>
      finalized(await store.markDispatchAmbiguous(id, expectedVersion, updatedAt)),
    resolveDispatchAmbiguous: async (id, owner, expectedVersion, updatedAt) =>
      finalized(await store.resolveDispatchAmbiguous(id, owner, expectedVersion, updatedAt)),
    applyObservation: async (id, input) => finalized(await store.applyObservation(id, input)),
    claimReceipt: async (id, input) => finalized(await store.claimReceipt(id, input)),
  };
}

export function withProviderCustomerEvents(store: FundingProviderCustomerStore, record: Recorder): FundingProviderCustomerStore {
  const changed = async <T extends FundingProviderCustomer | null>(result: T): Promise<T> => {
    await recordSafely(customerEvents(result), record);
    return result;
  };
  return {
    reserve: (input) => store.reserve(input),
    get: (owner, providerId, region) => store.get(owner, providerId, region),
    list: (owner, region) => store.list(owner, region),
    completeCreate: async (id, input) => changed(await store.completeCreate(id, input)),
    markRejected: async (id, expectedVersion, updatedAt) => changed(await store.markRejected(id, expectedVersion, updatedAt)),
    markDispatchAmbiguous: async (id, expectedVersion, updatedAt) =>
      changed(await store.markDispatchAmbiguous(id, expectedVersion, updatedAt)),
    claimVerification: (id, expectedVersion, updatedAt) => store.claimVerification(id, expectedVersion, updatedAt),
    markVerified: async (id, expectedVersion, updatedAt) => changed(await store.markVerified(id, expectedVersion, updatedAt)),
  };
}
