import "server-only";

import { beforeEach, describe, expect, test } from "bun:test";
import type {
  PriceObservation,
  PriceObservationStore,
} from "./price-observation-store";

const ASSET_KEY =
  "eip155:8453/erc20:0x1111111111111111111111111111111111111111";

export function priceObservationStoreContract(options: {
  name: string;
  createStore: () => PriceObservationStore;
  reset: () => Promise<void> | void;
}) {
  describe(`${options.name} PriceObservationStore contract`, () => {
    let store: PriceObservationStore;

    beforeEach(async () => {
      await options.reset();
      store = options.createStore();
    });

    test("round-trips observations and keeps the newer source time", async () => {
      await store.putMany([observation("2026-09-13T11:00:00.000Z", "1")]);
      await store.putMany([observation("2026-09-13T12:00:00.000Z", "2")]);
      await store.putMany([observation("2026-09-13T11:30:00.000Z", "3")]);

      expect(await store.getMany([ASSET_KEY])).toEqual([{
        assetKey: ASSET_KEY,
        unitPrice: { atoms: "2", scale: 0 },
        asOf: "2026-09-13T12:00:00.000Z",
        fetchedAt: "2026-09-13T12:00:01.000Z",
      }]);
    });

    test("returns only requested observations", async () => {
      await store.putMany([observation("2026-09-13T12:00:00.000Z", "2")]);
      expect(await store.getMany(["missing"])).toEqual([]);
    });
  });
}

function observation(asOf: string, atoms: string): PriceObservation {
  return {
    assetKey: ASSET_KEY,
    unitPrice: { atoms, scale: 0 },
    asOf,
    fetchedAt: "2026-09-13T12:00:01.000Z",
  };
}
