import "server-only";

import type {
  PriceObservation,
  PriceObservationStore,
} from "./price-observation-store";

export class MemoryPriceObservationStore implements PriceObservationStore {
  private readonly rows = new Map<string, PriceObservation>();

  async getMany(assetKeys: readonly string[]): Promise<PriceObservation[]> {
    return assetKeys.flatMap((assetKey) => {
      const row = this.rows.get(assetKey);
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
}
