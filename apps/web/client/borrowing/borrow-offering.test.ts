import { describe, expect, test } from "bun:test";
import { deploymentProductSettings, resolveProductOffering } from "@/shared/operator-settings/products";
import { borrowEntryOffered } from "./borrow-offering";

const settings = deploymentProductSettings();
const allReducing = resolveProductOffering({
  kind: "saved",
  value: { ...settings, markets: Object.fromEntries(Object.keys(settings.markets).map((id) => [id, "reducing-only" as const])) },
});
const exitOnly = resolveProductOffering({
  kind: "saved",
  value: { ...settings, products: { ...settings.products, borrow: "exit-only" } },
});

describe("borrow entry offering", () => {
  test("a deployment catalog with an enabled market offers the entry", () => {
    expect(borrowEntryOffered(resolveProductOffering({ kind: "deployment" }))).toBe(true);
  });

  test("every market reducing-only offers no entry even while Borrow is on", () => {
    expect(allReducing.products.borrow).toBe("on");
    expect(borrowEntryOffered(allReducing)).toBe(false);
  });

  test("exit-only Borrow offers no entry", () => {
    expect(borrowEntryOffered(exitOnly)).toBe(false);
  });

  test("an unreadable offering offers no entry", () => {
    expect(borrowEntryOffered(resolveProductOffering({ kind: "unavailable" }))).toBe(false);
  });
});
