import type { AccountProvider } from "@/shared/account/session-types";
import type {
  Instruction,
  OrderState,
  Quote,
  ReportedState,
} from "@/shared/funding/provider-contract";

export type FundingOrderOwner = {
  subject: string;
  accountProvider: AccountProvider;
};

export type FundingOrder = {
  id: string;
  owner: FundingOrderOwner;
  destination: `0x${string}`;
  providerId: string;
  region: string;
  assetId: string;
  paymentMethod: string;
  fiatAmount: string;
  intentDigest: string;
  quote: Quote;
  quoteToken: string;
  customerRef: string | null;
  state: OrderState;
  creationBlock: string;
  providerOrderId: string | null;
  expectedTokenAmountAtomic: string | null;
  fees: Quote["fees"];
  expiresAt: string | null;
  instructions: Instruction | null;
  providerStatus: string | null;
  providerTransactionHash: `0x${string}` | null;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type FundingReservation = Pick<FundingOrder,
  "id" | "owner" | "destination" | "providerId" | "region" | "assetId" |
  "paymentMethod" | "fiatAmount" | "intentDigest" | "quote" | "quoteToken" | "customerRef" |
  "creationBlock" | "createdAt"
>;

export interface FundingOrderStore {
  reserve(input: FundingReservation): Promise<{ created: boolean; order: FundingOrder }>;
  getOwned(id: string, owner: FundingOrderOwner): Promise<FundingOrder | null>;
  getByIntent(owner: FundingOrderOwner, intentDigest: string): Promise<FundingOrder | null>;
  getOpen(owner: FundingOrderOwner, region: string): Promise<FundingOrder | null>;
  getByProviderOrderId(providerId: string, providerOrderId: string): Promise<FundingOrder | null>;
  findCustomerRef(owner: FundingOrderOwner, providerId: string, region: string): Promise<string | null>;
  completeDispatch(id: string, input: {
    providerOrderId: string;
    expectedTokenAmountAtomic: string;
    fees: Quote["fees"];
    expiresAt: string | null;
    instructions: Instruction;
    expectedVersion: number;
    updatedAt: string;
  }): Promise<FundingOrder>;
  markDispatchAmbiguous(id: string, expectedVersion: number, updatedAt: string): Promise<FundingOrder>;
  applyObservation(id: string, input: {
    state: ReportedState | "sent-unverified";
    providerStatus: string;
    providerTransactionHash?: `0x${string}` | null;
    expectedVersion: number;
    updatedAt: string;
  }): Promise<FundingOrder | null>;
  claimReceipt(id: string, input: {
    transactionHash: `0x${string}`;
    logIndex: number;
    expectedVersion: number;
    updatedAt: string;
  }): Promise<FundingOrder | null>;
}

const terminalStates: ReadonlySet<OrderState> = new Set([
  "dispatch-ambiguous", "received", "expired", "cancelled", "failed", "refunded",
]);

export function isTerminalFundingState(state: OrderState): boolean {
  return terminalStates.has(state);
}

export class MemoryFundingOrderStore implements FundingOrderStore {
  private readonly orders = new Map<string, FundingOrder>();
  private readonly intents = new Map<string, string>();
  private readonly providerOrders = new Map<string, string>();
  private readonly receipts = new Map<string, string>();

  async reserve(input: FundingReservation) {
    const intentKey = ownerKey(input.owner, input.intentDigest);
    const existingId = this.intents.get(intentKey);
    if (existingId) return { created: false, order: clone(this.required(existingId)) };
    if (this.orders.has(input.id)) throw new Error("funding-order-id-conflict");
    const order: FundingOrder = {
      ...clone(input), state: "reserving", providerOrderId: null,
      expectedTokenAmountAtomic: null, fees: [], expiresAt: null, instructions: null,
      providerStatus: null, providerTransactionHash: null, transactionHash: null,
      logIndex: null, version: 0, updatedAt: input.createdAt,
    };
    this.orders.set(order.id, order);
    this.intents.set(intentKey, order.id);
    return { created: true, order: clone(order) };
  }

  async getOwned(id: string, owner: FundingOrderOwner) {
    const order = this.orders.get(id);
    return order && sameOwner(order.owner, owner) ? clone(order) : null;
  }

  async getByIntent(owner: FundingOrderOwner, intentDigest: string) {
    const id = this.intents.get(ownerKey(owner, intentDigest));
    return id ? clone(this.required(id)) : null;
  }

  async getOpen(owner: FundingOrderOwner, region: string) {
    return cloneOrNull([...this.orders.values()].reverse().find((order) =>
      sameOwner(order.owner, owner) && order.region === region
        && (!isTerminalFundingState(order.state) || order.state === "dispatch-ambiguous"),
    ));
  }

  async getByProviderOrderId(providerId: string, providerOrderId: string) {
    const id = this.providerOrders.get(`${providerId}:${providerOrderId}`);
    return id ? clone(this.required(id)) : null;
  }

  async findCustomerRef(owner: FundingOrderOwner, providerId: string, region: string) {
    return [...this.orders.values()].reverse().find((order) =>
      sameOwner(order.owner, owner) && order.providerId === providerId && order.region === region && order.customerRef,
    )?.customerRef ?? null;
  }

  async completeDispatch(id: string, input: Parameters<FundingOrderStore["completeDispatch"]>[1]) {
    const order = this.required(id);
    if (order.state !== "reserving" || order.version !== input.expectedVersion) throw new Error("funding-order-already-dispatched");
    const key = `${order.providerId}:${input.providerOrderId}`;
    const claimed = this.providerOrders.get(key);
    if (claimed && claimed !== id) throw new Error("funding-provider-order-conflict");
    Object.assign(order, {
      providerOrderId: input.providerOrderId,
      expectedTokenAmountAtomic: input.expectedTokenAmountAtomic,
      fees: input.fees,
      expiresAt: input.expiresAt,
      instructions: input.instructions,
      updatedAt: input.updatedAt,
      state: "awaiting-payment" as const,
      version: order.version + 1,
    });
    this.providerOrders.set(key, id);
    return clone(order);
  }

  async markDispatchAmbiguous(id: string, expectedVersion: number, updatedAt: string) {
    const order = this.required(id);
    if (order.state !== "reserving" || order.version !== expectedVersion) throw new Error("funding-order-already-dispatched");
    Object.assign(order, { state: "dispatch-ambiguous" as const, updatedAt, instructions: null, version: order.version + 1 });
    return clone(order);
  }

  async applyObservation(id: string, input: Parameters<FundingOrderStore["applyObservation"]>[1]) {
    const order = this.required(id);
    if (isTerminalFundingState(order.state) || order.version !== input.expectedVersion) return null;
    const state = nextFundingState(order.state, input.state);
    if (!state) return null;
    Object.assign(order, {
      state,
      providerStatus: input.providerStatus,
      ...(input.providerTransactionHash ? { providerTransactionHash: input.providerTransactionHash } : {}),
      updatedAt: input.updatedAt,
      version: order.version + 1,
    });
    if (isTerminalFundingState(order.state)) order.instructions = null;
    return clone(order);
  }

  async claimReceipt(id: string, input: Parameters<FundingOrderStore["claimReceipt"]>[1]) {
    const order = this.required(id);
    if (isTerminalFundingState(order.state) || order.version !== input.expectedVersion) return null;
    const key = `${input.transactionHash.toLowerCase()}:${input.logIndex}`;
    const claimed = this.receipts.get(key);
    if (claimed && claimed !== id) return null;
    this.receipts.set(key, id);
    Object.assign(order, {
      transactionHash: input.transactionHash,
      logIndex: input.logIndex,
      updatedAt: input.updatedAt,
      state: "received" as const,
      instructions: null,
      version: order.version + 1,
    });
    return clone(order);
  }

  private required(id: string): FundingOrder {
    const order = this.orders.get(id);
    if (!order) throw new Error("funding-order-not-found");
    return order;
  }
}

export function nextFundingState(current: OrderState, reported: ReportedState | "sent-unverified"): OrderState | null {
  if (isTerminalFundingState(current)) return null;
  if (isTerminalFundingState(reported)) return reported;
  const rank: Partial<Record<OrderState, number>> = {
    reserving: -1,
    unknown: 0,
    "awaiting-payment": 1,
    "payment-received": 2,
    settling: 3,
    sent: 4,
    "sent-unverified": 4,
  };
  return (rank[reported] ?? -1) >= (rank[current] ?? -1) ? reported : null;
}

function ownerKey(owner: FundingOrderOwner, suffix: string): string {
  return `${owner.accountProvider}:${owner.subject}:${suffix}`;
}
function sameOwner(left: FundingOrderOwner, right: FundingOrderOwner): boolean {
  return left.subject === right.subject && left.accountProvider === right.accountProvider;
}
function clone<T>(value: T): T { return structuredClone(value); }
function cloneOrNull(value: FundingOrder | undefined): FundingOrder | null { return value ? clone(value) : null; }
