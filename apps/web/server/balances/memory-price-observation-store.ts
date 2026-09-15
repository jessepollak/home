import "server-only";

import type {
  PriceObservation,
  PriceObservationStore,
  ValuationAttempt,
} from "./price-observation-store";

export class MemoryPriceObservationStore implements PriceObservationStore {
  private readonly rows = new Map<string, PriceObservation>();
  private readonly attempts = new Map<string, ValuationAttempt>();

  async getMany(assetKeys: readonly string[]): Promise<PriceObservation[]> {
    return assetKeys.flatMap((assetKey) => {
      const row = this.rows.get(assetKey);
      return row ? [structuredClone(row)] : [];
    });
  }

  async getAttempts(assetKeys: readonly string[]): Promise<ValuationAttempt[]> {
    return assetKeys.flatMap((assetKey) => {
      const row = this.attempts.get(assetKey);
      return row ? [structuredClone(row)] : [];
    });
  }

  async putMany(observations: readonly PriceObservation[]): Promise<void> {
    for (const observation of observations) {
      const existing = this.rows.get(observation.assetKey);
      if (existing && (
        Date.parse(observation.asOf) < Date.parse(existing.asOf) ||
        (observation.asOf === existing.asOf &&
          Date.parse(observation.fetchedAt) <= Date.parse(existing.fetchedAt))
      )) continue;
      this.rows.set(observation.assetKey, structuredClone(observation));
    }
  }

  async putAttempts(attempts: readonly ValuationAttempt[]): Promise<void> {
    for (const attempt of attempts) {
      const existing = this.attempts.get(attempt.assetKey);
      if (existing && Date.parse(attempt.attemptAt) <= Date.parse(existing.attemptAt)) continue;
      this.attempts.set(attempt.assetKey, structuredClone(attempt));
    }
  }
}
