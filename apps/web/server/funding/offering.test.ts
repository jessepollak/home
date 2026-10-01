import "server-only";

import { describe, expect, test } from "bun:test";
import { peerProvider } from "./providers/peer/adapter";
import { idrxProvider } from "./providers/idrx/adapter";
import { createCashoutCorridorOfferingReader, readFundingOffering, resolveFundingOffering } from "./offering";
import type { FundingSettings, SettingsEntry } from "@/shared/operator-settings/contract";
import { parseFundingSettings } from "@/shared/operator-settings/contract";
import type { FundingProvider } from "@/shared/funding/provider-contract";

const entry = (source: "default" | "stored", corridors: FundingSettings["corridors"] = []): SettingsEntry<FundingSettings> => ({
  domain: "funding", settings: { value: { corridors }, revision: source === "stored" ? 2 : 0, source,
    updatedAt: source === "stored" ? "2026-09-25T00:00:00.000Z" : null, updatedBy: source === "stored" ? "operator" : null },
});
const peer = { providerId: "peer", region: "US", direction: "offramp" as const };
const idrx = { providerId: "idrx", region: "ID", direction: "onramp" as const };
const providers = [peerProvider, idrxProvider];
const env = { PEER_OFFRAMP_ENABLED: " 1 ", IDRX_CLIENT_ID: "sentinel-secret-not-for-view", IDRX_CLIENT_SECRET: "configured", IDRX_CUSTOMER_NAME: "configured" };

function resolve(source: "default" | "stored", corridors: FundingSettings["corridors"] = [], environment: Record<string, string> = env) {
  return resolveFundingOffering({ providers, env: environment, entry: entry(source, corridors) });
}

function peerOfframpFixture() {
  const binding = peerProvider.manifest.bindings.find((candidate) => Boolean(candidate.directions.offramp));
  const offramp = binding?.directions.offramp;
  const method = offramp?.paymentMethods[0];
  if (!binding || !offramp || !method) throw new Error("peer fixture must declare an offramp binding with a payment method");
  return { binding, offramp, method };
}

const multiBindingProvider: FundingProvider = {
  ...idrxProvider,
  manifest: {
    ...idrxProvider.manifest,
    bindings: [
      { region: "US", assetId: "base:usdc", currency: "USD", directions: { onramp: {
        paymentMethods: [{ id: "bank", label: "Bank transfer" }], env: ["BANK_KEY", "SHARED_KEY"], legacyOfferedEnv: "BANK_ENABLED",
      } } },
      { region: "US", assetId: "base:usdc", currency: "EUR", directions: { onramp: {
        paymentMethods: [{ id: "alternate-bank", label: "Bank transfer" }, { id: "card", label: "Card" }], env: ["CARD_KEY", "SHARED_KEY"],
      } } },
    ],
  },
};
const multiEnv = { BANK_KEY: "set", CARD_KEY: "set", SHARED_KEY: "set", BANK_ENABLED: "1" };
const multiKey = { providerId: "idrx", region: "US", direction: "onramp" as const };
function resolveMulti(source: "default" | "stored" = "default", corridors: FundingSettings["corridors"] = [], environment: Record<string, string> = multiEnv, provider = multiBindingProvider) {
  return resolveFundingOffering({ providers: [provider], env: environment, entry: entry(source, corridors) });
}

describe("funding offering", () => {
  test("deployment selects connected corridors and honors the legacy Peer switch", () => {
    const off = resolve("default", [], { ...env, PEER_OFFRAMP_ENABLED: "" });
    expect(off.isOffered("peer", "US", "offramp")).toBe(false);
    expect(off.isSelected("peer", "US", "offramp")).toBe(false);
    expect(off.source).toBe("deployment");
    expect(off.view.legacy).toEqual([{ name: "PEER_OFFRAMP_ENABLED", state: "unset" }]);
    const on = resolve("default");
    expect(on.isOffered("peer", "US", "offramp")).toBe(true);
    expect(on.isSelected("peer", "US", "offramp")).toBe(true);
    expect(on.view.legacy).toEqual([{ name: "PEER_OFFRAMP_ENABLED", state: "in-effect" }]);
    expect(on.isOffered("idrx", "ID", "onramp")).toBe(true);
    expect(on.isOffered("absent", "US", "offramp")).toBe(false);
    expect(on.view.corridors.find((corridor) => corridor.key === "peer:US:offramp")).toMatchObject({
      connection: "connected", selected: true, offered: true, regionName: "United States", paymentMethods: ["Cash App", "Zelle"],
    });
    expect(on.view.providers.find((provider) => provider.providerId === "peer")?.credentials).toEqual([]);
    expect(on.view.providers.find((provider) => provider.providerId === "idrx")?.credentials).toEqual([
      { name: "IDRX_CLIENT_ID", state: "set" }, { name: "IDRX_CLIENT_SECRET", state: "set" }, { name: "IDRX_CUSTOMER_NAME", state: "set" },
    ]);
  });

  test("stored selections override env; new and unknown corridors do not offer", () => {
    const result = resolve("stored", [{ ...peer, offered: false }, { ...idrx, offered: true },
      { providerId: "unknown", region: "US", direction: "onramp", offered: true }]);
    expect(result.isOffered("peer", "US", "offramp")).toBe(false);
    expect(result.isSelected("peer", "US", "offramp")).toBe(false);
    expect(result.source).toBe("saved");
    expect(result.isOffered("idrx", "ID", "onramp")).toBe(true);
    const disconnected = resolve("stored", [{ ...idrx, offered: true }], { PEER_OFFRAMP_ENABLED: "1" });
    expect(disconnected.isOffered("idrx", "ID", "onramp")).toBe(false);
    expect(disconnected.isSelected("idrx", "ID", "onramp")).toBe(true);
    expect(result.view.legacy).toEqual([{ name: "PEER_OFFRAMP_ENABLED", state: "ignored" }]);
    expect(result.view.unknownSaved).toEqual([{ providerId: "unknown", region: "US", direction: "onramp" }]);
    expect(result.view.corridors.find((corridor) => corridor.key === "peer:GB:offramp")).toMatchObject({ selected: false, offered: false, newSinceSave: true });
    expect(disconnected.view.corridors.find((corridor) => corridor.key === "idrx:ID:onramp")).toMatchObject({
      selected: true, offered: false, connection: "not-connected", missingEnv: ["IDRX_CLIENT_ID", "IDRX_CLIENT_SECRET", "IDRX_CUSTOMER_NAME"],
    });
    expect(result.view).toMatchObject({ source: "saved", revision: 2, updatedBy: "operator" });
    expect(JSON.stringify(result.view)).not.toContain("sentinel-secret-not-for-view");
  });

  test("coalesces bindings into one savable corridor with ordered methods and currencies", () => {
    const result = resolveMulti();
    const { corridors } = result.view;
    expect(corridors).toHaveLength(1);
    expect(new Set(corridors.map((row) => row.key)).size).toBe(corridors.length);
    expect(corridors[0]).toMatchObject({
      key: "idrx:US:onramp", currency: "USD / EUR", paymentMethods: ["Bank transfer", "Card"],
      connection: "connected", selected: true, offered: true,
    });
    expect(corridors[0]?.credentials).toEqual([
      { name: "BANK_KEY", state: "set" }, { name: "CARD_KEY", state: "set" }, { name: "SHARED_KEY", state: "set" },
    ]);
    const payload = { corridors: corridors.map(({ providerId, region, direction, offered }) => ({ providerId, region, direction, offered })) };
    const parsed = parseFundingSettings(payload);
    if (!parsed) throw new Error("expected funding settings to parse");
    expect(new Set(parsed.corridors.map(({ providerId, region, direction }) => `${providerId}:${region}:${direction}`)).size).toBe(parsed.corridors.length);
  });

  test("coalesced bindings show every distinct evidence note exactly once", () => {
    const { binding: base, offramp, method } = peerOfframpFixture();
    const provider: FundingProvider = {
      ...peerProvider,
      manifest: {
        ...peerProvider.manifest,
        bindings: [
          { ...base, directions: { offramp: { ...offramp, paymentMethods: [method], confirmedBy: "Live $1 transfer on Sep 18" } } },
          { ...base, directions: { offramp: { ...offramp, paymentMethods: [{ ...method, id: "second-method", label: "Second method" }], confirmedBy: "Sandbox transfer on Sep 21" } } },
          { ...base, directions: { offramp: { ...offramp, paymentMethods: [{ ...method, id: "third-method", label: "Third method" }], confirmedBy: "Live $1 transfer on Sep 18" } } },
        ],
      },
    };
    const result = resolveFundingOffering({ providers: [provider], env, entry: entry("default") });
    expect(result.view.corridors).toHaveLength(1);
    expect(result.view.corridors[0]?.paymentMethods).toEqual([method.label, "Second method", "Third method"]);
    expect(result.view.corridors[0]?.confirmedBy).toBe("Live $1 transfer on Sep 18; Sandbox transfer on Sep 21");
  });

  test("a coalesced binding with an empty evidence note keeps its sibling's note", () => {
    const { binding: base, offramp, method } = peerOfframpFixture();
    const provider: FundingProvider = {
      ...peerProvider,
      manifest: {
        ...peerProvider.manifest,
        bindings: [
          { ...base, directions: { offramp: { ...offramp, paymentMethods: [method], confirmedBy: "" } } },
          { ...base, directions: { offramp: { ...offramp, paymentMethods: [{ ...method, id: "second-method", label: "Second method" }], confirmedBy: "  Sandbox transfer on Sep 21  " } } },
        ],
      },
    };
    const result = resolveFundingOffering({ providers: [provider], env, entry: entry("default") });
    expect(result.view.corridors[0]?.confirmedBy).toBe("Sandbox transfer on Sep 21");
    const unconfirmed: FundingProvider = {
      ...provider,
      manifest: { ...provider.manifest, bindings: provider.manifest.bindings.map((binding) => {
        const offramp = binding.directions.offramp;
        if (!offramp) throw new Error("peer fixture must declare an offramp direction");
        return { ...binding, directions: { offramp: { ...offramp, confirmedBy: "" } } };
      }) },
    };
    expect(resolveFundingOffering({ providers: [unconfirmed], env, entry: entry("default") }).view.corridors[0]?.confirmedBy).toBeNull();
  });

  test("a disconnected sibling makes the whole corridor unavailable with sorted missing credentials", () => {
    const result = resolveMulti("default", [], { BANK_KEY: "set", BANK_ENABLED: "1" });
    expect(result.view.corridors[0]).toMatchObject({
      connection: "not-connected", missingEnv: ["CARD_KEY", "SHARED_KEY"], offered: false,
    });
    expect(result.view.corridors[0]?.credentials).toEqual([
      { name: "BANK_KEY", state: "set" }, { name: "CARD_KEY", state: "unset" }, { name: "SHARED_KEY", state: "unset" },
    ]);
    expect(result.isOffered("idrx", "US", "onramp")).toBe(false);
    const bothMissing = resolveMulti("default", [], { BANK_ENABLED: "1" });
    expect(bothMissing.view.corridors[0]?.missingEnv).toEqual(["BANK_KEY", "CARD_KEY", "SHARED_KEY"]);
  });

  test("saved off selection controls every coalesced binding", () => {
    const result = resolveMulti("stored", [{ ...multiKey, offered: false }]);
    expect(result.view.corridors).toHaveLength(1);
    expect(result.view.corridors[0]).toMatchObject({ selected: false, offered: false, newSinceSave: false });
    expect(result.isSelected("idrx", "US", "onramp")).toBe(false);
    expect(result.isOffered("idrx", "US", "onramp")).toBe(false);
  });

  test("deployment selection requires all sibling switches, while directions stay distinct", () => {
    const off = resolveMulti("default", [], { BANK_KEY: "set", CARD_KEY: "set", SHARED_KEY: "set" });
    expect(off.view.corridors[0]).toMatchObject({ selected: false, offered: false });
    expect(off.isOffered("idrx", "US", "onramp")).toBe(false);
    const withOfframp: FundingProvider = {
      ...multiBindingProvider,
      offramp: peerProvider.offramp,
      manifest: {
        ...multiBindingProvider.manifest, offramp: peerProvider.manifest.offramp,
        bindings: [...multiBindingProvider.manifest.bindings, {
          region: "US", assetId: "base:usdc", currency: "USD", directions: { offramp: {
            paymentMethods: [{ id: "cashapp", label: "Cash App" }], env: [], confirmedBy: "",
          } },
        }, {
          region: "US", assetId: "base:usdc", currency: "EUR", directions: { offramp: {
            paymentMethods: [{ id: "zelle", label: "Zelle" }], env: [], confirmedBy: "confirmed",
          } },
        }],
      },
    };
    const result = resolveMulti("default", [], multiEnv, withOfframp);
    expect(result.view.corridors.map((row) => row.key)).toEqual(["idrx:US:onramp", "idrx:US:offramp"]);
    expect(result.view.corridors[0]).toMatchObject({ direction: "onramp", confirmedBy: null });
    expect(result.view.corridors[1]).toMatchObject({
      currency: "USD / EUR", confirmedBy: "confirmed", paymentMethods: ["Cash App", "Zelle"], offered: true,
    });
  });

  test("a binding that offers both directions keeps evidence on its own direction", () => {
    const bothDirections: FundingProvider = {
      ...idrxProvider,
      manifest: {
        ...idrxProvider.manifest,
        bindings: [{ region: "US", assetId: "base:usdc", currency: "USD", directions: {
          onramp: { paymentMethods: [{ id: "bank", label: "Bank transfer" }], env: [] },
          offramp: { paymentMethods: [{ id: "cashapp", label: "Cash App" }], env: [], confirmedBy: "confirmed" },
        } }],
      },
    };
    const result = resolveMulti("default", [], {}, bothDirections);
    expect(result.view.corridors.map((row) => row.key)).toEqual(["idrx:US:onramp", "idrx:US:offramp"]);
    expect(result.view.corridors[0]).toMatchObject({ direction: "onramp", confirmedBy: null });
    expect(result.view.corridors[1]).toMatchObject({ direction: "offramp", confirmedBy: "confirmed" });
  });

  test("reads only the funding settings domain and propagates read failures", async () => {
    const domains: string[] = [];
    const offering = await readFundingOffering({ providers, env, store: { read: async (domain) => {
      domains.push(domain);
      return entry("stored", [{ ...peer, offered: false }]);
    } } });
    expect(domains).toEqual(["funding"]);
    expect(offering.isOffered("peer", "US", "offramp")).toBe(false);
    await expect(readFundingOffering({ providers, env, store: { read: async () => { throw new Error("database unavailable"); } } }))
      .rejects.toThrow("database unavailable");
  });

  test("bounds the cash-out corridor read with a deadline", async () => {
    const reader = createCashoutCorridorOfferingReader({ read: async () => new Promise<never>(() => {}), deadlineMs: 20 });
    await expect(reader("peer", "US", "offramp", new AbortController().signal)).rejects.toThrow("Funding settings read timed out");
  });

  test("propagates a request abort into the cash-out corridor read", async () => {
    const controller = new AbortController();
    const reader = createCashoutCorridorOfferingReader({
      read: (options) => new Promise<never>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })),
      deadlineMs: 60_000,
    });
    const pending = reader("peer", "US", "offramp", controller.signal);
    controller.abort(new Error("client disconnected"));
    await expect(pending).rejects.toThrow("client disconnected");
  });
});
