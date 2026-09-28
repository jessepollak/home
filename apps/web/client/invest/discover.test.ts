import { expect, test } from "bun:test";
import { cryptoAssets, stockAssets, type InvestAsset } from "@/config/invest-assets";
import { createDiscoverShelves, getShelfAssets, getShelfPreviewAssets } from "./discover";

test("all wrapped assets appear in Crypto category; removed assets stay out of shelves and previews", () => {
  const removed = { ...cryptoAssets[0]!, listing: "removed" as const } satisfies InvestAsset;
  const shelves = createDiscoverShelves([removed, ...cryptoAssets.slice(1), ...stockAssets]);
  const crypto = shelves[1];
  expect(getShelfAssets(crypto).map(({ id }) => id)).toEqual(cryptoAssets.slice(1).map(({ id }) => id));
  expect(getShelfPreviewAssets(crypto).map(({ id }) => id)).not.toContain(removed.id);
  const removedStock = { ...stockAssets[0]!, listing: "removed" as const } satisfies InvestAsset;
  const stockShelf = createDiscoverShelves([removedStock, ...stockAssets.slice(1)])[0];
  expect(getShelfAssets(stockShelf).map(({ id }) => id)).not.toContain(removedStock.id);
  expect(getShelfPreviewAssets(stockShelf).map(({ id }) => id)).not.toContain(removedStock.id);
  expect(getShelfAssets(createDiscoverShelves(cryptoAssets)[1])).toHaveLength(8);
});
