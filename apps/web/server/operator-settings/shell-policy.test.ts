import { afterEach, describe, expect, jest, test } from "bun:test";
import type { CountryCode, RegionOffer } from "@/config/regions";
import { CustomerResolver } from "@/server/customers/resolve";
import type { SqlExecutor } from "@/server/db/sql";
import { CountryPreferenceStore, readCountryPreferenceForRender } from "@/server/preferences/country";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { INVEST_HIDE_ALL, type InvestSettings } from "@/shared/operator-settings/invest";
import { resolveProductOffering, type ProductOffering } from "@/shared/operator-settings/products";
import type { RegionSettings } from "@/shared/operator-settings/regions";
import { createInvestVisibilityReader } from "./invest";
import { createRegionPolicyReader, readRegionOfferForRender } from "./regions";
import { readShellPolicyForRender } from "./shell-policy";

const session: VerifiedAccountSession = {
  user: { subject: "shell-policy-account" },
  smartAccount: null,
  accountProvider: "cdp-embedded",
};

const regionOffer: RegionOffer = { offered: [], defaultRegion: "GLOBAL" };
const storedInvest: InvestSettings = { hiddenCategories: ["stock"], hiddenAssets: ["cbbtc"] };
const storedProduct: ProductOffering = resolveProductOffering({ kind: "deployment" });
const storedRegions: RegionSettings = { offered: ["GB"], defaultRegion: "GB" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { jest.useRealTimers(); });

describe("shell policy reads", () => {
  test("settles the signed-in preference before starting overlapping policy reads", async () => {
    const events: string[] = [];
    const preference = deferred<{ regionId: CountryCode | null }>();
    const invest = deferred<InvestSettings>();
    const product = deferred<ProductOffering>();
    const region = deferred<RegionOffer>();
    const investStarted = deferred<void>();
    const productStarted = deferred<void>();
    const pending = readShellPolicyForRender(session, {
      readCountryPreference: async (receivedSession) => {
        expect(receivedSession).toBe(session);
        events.push("start:country");
        const value = await preference.promise;
        events.push("end:country");
        return value;
      },
      readInvestSettings: () => {
        events.push("start:invest");
        investStarted.resolve();
        return invest.promise;
      },
      readProductOffering: () => {
        events.push("start:product");
        productStarted.resolve();
        return product.promise;
      },
      readRegionOffer: () => {
        events.push("start:region");
        return region.promise;
      },
    });

    expect(events).toEqual(["start:country"]);
    preference.resolve({ regionId: "US" });
    await investStarted.promise;
    expect(events).toEqual(["start:country", "end:country", "start:invest", "start:region"]);
    region.resolve(regionOffer);
    invest.resolve(INVEST_HIDE_ALL);
    await productStarted.promise;
    expect(events).toEqual(["start:country", "end:country", "start:invest", "start:region", "start:product"]);
    product.resolve(storedProduct);
    const result = await pending;
    expect(result).toEqual({
      accountPreference: { accountProvider: "cdp-embedded", subject: "shell-policy-account", regionId: "US" },
      investVisibility: INVEST_HIDE_ALL,
      productOffering: storedProduct,
      regionOffer,
    });
  });

  test("starts the paired policy readers immediately without a session, then reads the product offering", async () => {
    const events: string[] = [];
    const invest = deferred<InvestSettings>();
    const product = deferred<ProductOffering>();
    const region = deferred<RegionOffer>();
    const productStarted = deferred<void>();
    const pending = readShellPolicyForRender(null, {
      readCountryPreference: () => {
        events.push("country");
        return Promise.resolve({ regionId: "US" });
      },
      readInvestSettings: () => {
        events.push("invest");
        return invest.promise;
      },
      readProductOffering: () => {
        events.push("product");
        productStarted.resolve();
        return product.promise;
      },
      readRegionOffer: () => {
        events.push("region");
        return region.promise;
      },
    });

    expect(events).toEqual(["invest", "region"]);
    invest.resolve(INVEST_HIDE_ALL);
    region.resolve(regionOffer);
    await productStarted.promise;
    expect(events).toEqual(["invest", "region", "product"]);
    product.resolve(storedProduct);
    const result = await pending;
    expect(result.accountPreference).toBeNull();
    expect(result.investVisibility).toBe(INVEST_HIDE_ALL);
    expect(result.productOffering).toBe(storedProduct);
    expect(result.regionOffer).toBe(regionOffer);
  });

  test.each([
    { name: "known-empty", preference: { regionId: null }, seed: { accountProvider: "cdp-embedded", subject: "shell-policy-account", regionId: null } },
    { name: "unavailable", preference: null, seed: null },
  ])("preserves a $name preference outcome before reading policies", async ({ preference, seed }) => {
    const country = deferred<{ regionId: CountryCode | null } | null>();
    const events: string[] = [];
    const pending = readShellPolicyForRender(session, {
      readCountryPreference: () => { events.push("country"); return country.promise; },
      readInvestSettings: async () => { events.push("invest"); return storedInvest; },
      readProductOffering: async () => { events.push("product"); return storedProduct; },
      readRegionOffer: async () => { events.push("region"); return storedRegions; },
    });
    expect(events).toEqual(["country"]);
    country.resolve(preference);
    expect(await pending).toEqual({ accountPreference: seed, investVisibility: storedInvest, productOffering: storedProduct, regionOffer: storedRegions });
    expect(events).toEqual(["country", "invest", "region", "product"]);
  });

  test("a timed-out country read supplies no seed and then starts every policy read", async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const sql: SqlExecutor = {
      query: (_text, _values, options) => { signal = options?.signal; return new Promise(() => {}); },
      transaction: async () => { throw new Error("Unexpected transaction"); },
    };
    const store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
    const events: string[] = [];
    const pending = readShellPolicyForRender(session, {
      readCountryPreference: (owner) => readCountryPreferenceForRender(owner, store),
      readInvestSettings: async () => { events.push("invest"); return storedInvest; },
      readProductOffering: async () => { events.push("product"); return storedProduct; },
      readRegionOffer: async () => { events.push("region"); return storedRegions; },
    });
    expect(events).toEqual([]);
    expect(signal?.aborted).toBe(false);
    void jest.runAllTimers();
    expect(signal?.aborted).toBe(true);
    expect(await pending).toEqual({ accountPreference: null, investVisibility: storedInvest, productOffering: storedProduct, regionOffer: storedRegions });
    expect(events).toEqual(["invest", "region", "product"]);
  });

  test("an unavailable country query supplies no seed without suppressing policy reads", async () => {
    const sql: SqlExecutor = {
      query: async () => { throw new Error("Database unavailable"); },
      transaction: async () => { throw new Error("Unexpected transaction"); },
    };
    const store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
    expect(await readShellPolicyForRender(session, {
      readCountryPreference: (owner) => readCountryPreferenceForRender(owner, store),
      readInvestSettings: async () => storedInvest,
      readProductOffering: async () => storedProduct,
      readRegionOffer: async () => storedRegions,
    })).toEqual({ accountPreference: null, investVisibility: storedInvest, productOffering: storedProduct, regionOffer: storedRegions });
  });

  test.each(["invest", "region", "both"] as const)("retains reader-owned fallback when %s policy is unavailable", async (failed) => {
    const invest = createInvestVisibilityReader({ now: () => 0, read: async () => {
      if (failed !== "region") throw new Error("Invest unavailable");
      return { value: storedInvest, source: "stored" };
    } });
    const region = createRegionPolicyReader({ now: () => 0, read: async () => {
      if (failed !== "invest") throw new Error("Regions unavailable");
      return { value: storedRegions, source: "stored" };
    } });
    expect(await readShellPolicyForRender(session, {
      readCountryPreference: async () => ({ regionId: "US" }),
      readInvestSettings: invest.readSettings,
      readProductOffering: async () => storedProduct,
      readRegionOffer: () => readRegionOfferForRender(region.read),
    })).toEqual({
      accountPreference: { accountProvider: "cdp-embedded", subject: "shell-policy-account", regionId: "US" },
      investVisibility: failed === "region" ? storedInvest : INVEST_HIDE_ALL,
      productOffering: storedProduct,
      regionOffer: failed === "invest" ? storedRegions : { offered: [], defaultRegion: "GLOBAL" },
    });
  });

  test("a late owner A preference cannot replace owner B's seed", async () => {
    const ownerB: VerifiedAccountSession = { user: { subject: "owner-b" }, accountProvider: "base-account", smartAccount: null };
    const countryA = deferred<{ regionId: CountryCode | null }>();
    const countryB = deferred<{ regionId: CountryCode | null }>();
    const received: VerifiedAccountSession[] = [];
    const readers = {
      readCountryPreference: (owner: VerifiedAccountSession) => {
        received.push(owner);
        return owner === session ? countryA.promise : countryB.promise;
      },
      readInvestSettings: async () => storedInvest,
      readProductOffering: async () => storedProduct,
      readRegionOffer: async () => storedRegions,
    };
    let ownerAFinished = false;
    const pendingA = readShellPolicyForRender(session, readers).then((result) => { ownerAFinished = true; return result; });
    const pendingB = readShellPolicyForRender(ownerB, readers);
    expect(received).toEqual([session, ownerB]);
    countryB.resolve({ regionId: "GB" });
    const resultB = await pendingB;
    expect(ownerAFinished).toBe(false);
    expect(resultB.accountPreference).toEqual({ accountProvider: "base-account", subject: "owner-b", regionId: "GB" });
    countryA.resolve({ regionId: "US" });
    expect((await pendingA).accountPreference).toEqual({ accountProvider: "cdp-embedded", subject: "shell-policy-account", regionId: "US" });
    expect(resultB.accountPreference).toEqual({ accountProvider: "base-account", subject: "owner-b", regionId: "GB" });
  });

  test.each(["country", "invest", "product", "region"] as const)("propagates an unexpected injected %s rejection", async (failed) => {
    const error = new Error("Unexpected reader rejection");
    const events: string[] = [];
    await expect(readShellPolicyForRender(session, {
      readCountryPreference: async () => { events.push("country"); if (failed === "country") throw error; return { regionId: "US" }; },
      readInvestSettings: async () => { events.push("invest"); if (failed === "invest") throw error; return storedInvest; },
      readProductOffering: async () => { events.push("product"); if (failed === "product") throw error; return storedProduct; },
      readRegionOffer: async () => { events.push("region"); if (failed === "region") throw error; return storedRegions; },
    })).rejects.toBe(error);
    expect(events).toEqual(failed === "country" ? ["country"]
      : failed === "product" ? ["country", "invest", "region", "product"]
        : ["country", "invest", "region"]);
  });

  test("four overlapping signed-in renders keep their seeds within a five-slot pool on cold policy reads", async () => {
    jest.useFakeTimers();
    const poolCapacity = 5;
    const countries: CountryCode[] = ["US", "GB", "BR", "ID"];
    const owners = countries.map((_, index): VerifiedAccountSession => ({ ...session, user: { subject: `pool-owner-${index}` } }));
    const savedCountries = new Map(owners.map((owner, index) => [owner.user.subject, countries[index]]));
    const held = new Map<string, ReturnType<typeof deferred<void>>>();
    const queryStarts: string[] = [];
    const investStarted = deferred<void>();
    const allPoliciesJoined = deferred<void>();
    const allProductsJoined = deferred<void>();
    let activeQueries = 0;
    let peakQueries = 0;
    let investCalls = 0;
    let productCalls = 0;
    let regionCalls = 0;
    const sql: SqlExecutor = {
      async query<T>(text: string, values?: unknown[]) {
        const key = values ? String(values[1]) : text;
        queryStarts.push(key);
        activeQueries++;
        peakQueries = Math.max(peakQueries, activeQueries);
        try {
          if (activeQueries > poolCapacity) throw new Error("Pool capacity exceeded");
          const completion = deferred<void>();
          held.set(key, completion);
          if (key === "invest") investStarted.resolve();
          await completion.promise;
          const rows = savedCountries.has(key) ? [{ country_preference: savedCountries.get(key) }] : [];
          return { rows: rows as T[], rowCount: rows.length };
        } finally {
          activeQueries--;
        }
      },
      transaction: async () => { throw new Error("Unexpected transaction"); },
    };
    const store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
    const invest = createInvestVisibilityReader({ now: () => 0, read: async () => {
      await sql.query("invest");
      return { value: storedInvest, source: "stored" };
    } });
    const region = createRegionPolicyReader({ now: () => 0, read: async () => {
      await sql.query("regions");
      return { value: storedRegions, source: "stored" };
    } });
    const pending = owners.map((owner) => readShellPolicyForRender(owner, {
      readCountryPreference: (receivedOwner) => readCountryPreferenceForRender(receivedOwner, store),
      readInvestSettings: () => { investCalls++; return invest.readSettings(); },
      readProductOffering: async () => {
        productCalls++;
        if (productCalls === owners.length) allProductsJoined.resolve();
        await sql.query(`products-${productCalls}`);
        return storedProduct;
      },
      readRegionOffer: () => {
        regionCalls++;
        if (regionCalls === owners.length) allPoliciesJoined.resolve();
        return readRegionOfferForRender(region.read);
      },
    }));

    expect(queryStarts).toEqual(owners.map((owner) => owner.user.subject));
    expect(activeQueries).toBe(owners.length);
    held.get(owners[0].user.subject)!.resolve();
    await investStarted.promise;
    expect(queryStarts).toEqual([...owners.map((owner) => owner.user.subject), "invest", "regions"]);
    expect(activeQueries).toBe(owners.length - 1 + 2);
    for (const owner of owners.slice(1)) held.get(owner.user.subject)!.resolve();
    await allPoliciesJoined.promise;
    expect(investCalls).toBe(owners.length);
    expect(regionCalls).toBe(owners.length);
    expect(productCalls).toBe(0);
    expect(queryStarts.filter((key) => key === "invest")).toHaveLength(1);
    expect(queryStarts.filter((key) => key === "regions")).toHaveLength(1);
    expect(peakQueries).toBeLessThanOrEqual(poolCapacity);
    held.get("regions")!.resolve();
    held.get("invest")!.resolve();
    await allProductsJoined.promise;
    expect(productCalls).toBe(owners.length);
    expect(queryStarts.filter((key) => key.startsWith("products-"))).toHaveLength(owners.length);
    expect(activeQueries).toBe(owners.length);
    expect(peakQueries).toBeLessThanOrEqual(poolCapacity);
    for (let index = 1; index <= owners.length; index++) {
      const entry = held.get(`products-${index}`);
      if (!entry) throw new Error("Expected a held product settings read.");
      entry.resolve();
    }
    const results = await Promise.all(pending);
    expect(results.map((result) => result.accountPreference)).toEqual(owners.map((owner, index) => ({
      accountProvider: "cdp-embedded", subject: owner.user.subject, regionId: countries[index],
    })));
    for (const result of results) {
      expect(result.investVisibility).toEqual(storedInvest);
      expect(result.productOffering).toEqual(storedProduct);
      expect(result.regionOffer).toEqual(storedRegions);
    }
    expect(activeQueries).toBe(0);
  });
});
