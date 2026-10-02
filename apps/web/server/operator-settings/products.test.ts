import { describe, expect, test } from "bun:test";
import { deploymentProductSettings, parseProductSettings } from "@/shared/operator-settings/products";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import { readProductSettingsEntryForPage } from "./products";

const stored = (value: unknown, revision = 3): SettingsEntry<unknown> => ({
  domain: "products",
  settings: { value, revision, source: "stored", updatedAt: null, updatedBy: null },
});

describe("product settings page read", () => {
  test("parses a stored row and returns the defaults when no row exists", async () => {
    const defaults = deploymentProductSettings();
    const saved = { ...defaults, products: { ...defaults.products, borrow: "exit-only" as const, send: "off" as const } };
    const entry = await readProductSettingsEntryForPage({ read: async () => stored(saved) });
    expect(entry?.settings.value.products).toEqual({ save: "on", borrow: "exit-only", invest: "on", send: "off" });
    expect(entry?.settings.revision).toBe(3);
    const fallback = await readProductSettingsEntryForPage({ read: async () => ({ domain: "products", settings: { value: defaults, revision: 0, source: "default", updatedAt: null, updatedBy: null } }) });
    expect(fallback?.settings.source).toBe("default");
  });

  test("rejects and aborts a stalled read at the deadline instead of hanging the page", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const pending = readProductSettingsEntryForPage({
      read: (options) => {
        signals.push(options.signal);
        return new Promise(() => {});
      },
      deadlineMs: 0,
    });
    await expect(pending).rejects.toThrow("Product settings read timed out");
    expect(signals[0]?.aborted).toBe(true);
  });

  test("returns null for a value the products parser refuses", async () => {
    expect(parseProductSettings({ nope: true })).toBeNull();
    await expect(readProductSettingsEntryForPage({ read: async () => stored({ products: { save: "on" } }) })).resolves.toBeNull();
  });
});
