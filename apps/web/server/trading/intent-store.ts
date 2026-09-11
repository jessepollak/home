import type { MoneyActionOwner } from "@/shared/money-actions/types";
import type { TradeIntent, TradeIntentStore } from "@/shared/trading/server-types";

export class MemoryTradeIntentStore implements TradeIntentStore {
  private readonly records = new Map<string, TradeIntent>();

  async issue(intent: TradeIntent): Promise<void> {
    if (this.records.has(intent.id)) throw new Error("duplicate-trade-intent");
    this.records.set(intent.id, structuredClone(intent));
  }

  async get(owner: MoneyActionOwner, id: string): Promise<TradeIntent | null> {
    const intent = this.records.get(id);
    return intent && sameOwner(intent.owner, owner) ? structuredClone(intent) : null;
  }

  async getByFinalActionId(owner: MoneyActionOwner, actionId: string): Promise<TradeIntent | null> {
    const intent = [...this.records.values()].find(
      (candidate) => candidate.finalActionId === actionId && sameOwner(candidate.owner, owner),
    );
    return intent ? structuredClone(intent) : null;
  }

  async bindFinalAction(input: {
    owner: MoneyActionOwner;
    id: string;
    intentHash: string;
    finalActionId: string;
    signatureDigest: string;
  }): Promise<TradeIntent | null> {
    const intent = this.records.get(input.id);
    if (!intent || !sameOwner(intent.owner, input.owner) || intent.intentHash !== input.intentHash) {
      return null;
    }
    if (intent.finalActionId && intent.finalActionId !== input.finalActionId) return null;
    if (intent.signatureDigest && intent.signatureDigest !== input.signatureDigest) return null;
    intent.finalActionId ??= input.finalActionId;
    intent.signatureDigest ??= input.signatureDigest;
    return structuredClone(intent);
  }
}

export function sameOwner(left: MoneyActionOwner, right: MoneyActionOwner): boolean {
  return left.subject === right.subject &&
    left.address.toLowerCase() === right.address.toLowerCase() &&
    left.chainId === right.chainId &&
    left.accountProvider === right.accountProvider;
}
