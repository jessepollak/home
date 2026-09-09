import { describe, expect, test } from "bun:test";
import type { HomeAssetBalancesPresentation } from "./present-home-balances";
import {
  clearHomeBalancesPresentationCache,
  deleteHomeBalancesPresentation,
  homeBalancesPresentationCacheKey,
  homeBalancesPresentationCachePrefix,
  homeBalancesPresentationCacheTtlMs,
  readHomeBalancesPresentation,
  resolvePaintedHomeBalances,
  writeHomeBalancesPresentation,
} from "./presentation-cache";

const OWNER = "home-user";
const SUBJECT = "subject-home";
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const OTHER_ACCOUNT = "0x2222222222222222222222222222222222222222" as const;
const SAVED_AT = "2026-09-09T16:00:00.000Z";
const NOW = Date.parse(SAVED_AT);

const readyPresentation: HomeAssetBalancesPresentation = {
  status: "ready",
  displayTotal: "$12.34",
  items: [
    {
      id: "usdc",
      group: "cash",
      name: "US dollar",
      displayBalance: "$12.34",
      currencyCode: "USD",
    },
  ],
};

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    snapshot() {
      return Object.fromEntries(values);
    },
  };
  return storage;
}

describe("home balances presentation cache", () => {
  test("round-trips a ready presentation and allowlists fields", () => {
    const storage = memoryStorage();
    expect(
      writeHomeBalancesPresentation(
        () => storage,
        {
          ownerKey: OWNER,
          subject: SUBJECT,
          smartAccount: ACCOUNT,
          region: "US",
        },
        {
          ...readyPresentation,
          revalidating: true,
          statusLabel: "Choose a country in Account to set how money is shown",
        },
        NOW,
      ),
    ).toBe(true);

    expect(
      readHomeBalancesPresentation(
        () => storage,
        { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
        NOW,
      ),
    ).toEqual({
      status: "ready",
      displayTotal: "$12.34",
      statusLabel: "Choose a country in Account to set how money is shown",
      items: readyPresentation.items,
    });
  });

  test("finds a same-owner record during Checking without subject or account", () => {
    const storage = memoryStorage();
    writeHomeBalancesPresentation(
      () => storage,
      {
        ownerKey: OWNER,
        subject: SUBJECT,
        smartAccount: ACCOUNT,
        region: "GLOBAL",
      },
      readyPresentation,
      NOW,
    );

    expect(
      readHomeBalancesPresentation(
        () => storage,
        { ownerKey: OWNER, region: "GLOBAL" },
        NOW,
      ),
    ).toEqual(readyPresentation);
  });

  test("does not persist loading, unavailable, or null totals", () => {
    const storage = memoryStorage();
    expect(
      writeHomeBalancesPresentation(
        () => storage,
        {
          ownerKey: OWNER,
          subject: SUBJECT,
          smartAccount: ACCOUNT,
          region: "US",
        },
        { status: "loading", displayTotal: null, items: [] },
        NOW,
      ),
    ).toBe(false);
    expect(
      writeHomeBalancesPresentation(
        () => storage,
        {
          ownerKey: OWNER,
          subject: SUBJECT,
          smartAccount: ACCOUNT,
          region: "US",
        },
        { status: "unavailable", displayTotal: null, items: [] },
        NOW,
      ),
    ).toBe(false);
    expect(
      writeHomeBalancesPresentation(
        () => storage,
        {
          ownerKey: OWNER,
          subject: SUBJECT,
          smartAccount: ACCOUNT,
          region: "US",
        },
        { status: "ready", displayTotal: null, items: [] },
        NOW,
      ),
    ).toBe(false);
    expect(storage.length).toBe(0);
  });

  test("fails open on corrupt, expired, mismatched, and token-like records", () => {
    const key = homeBalancesPresentationCacheKey({
      subject: SUBJECT,
      smartAccount: ACCOUNT,
      region: "US",
    });
    const expired = new Date(NOW - homeBalancesPresentationCacheTtlMs - 1).toISOString();
    const cases = [
      "{",
      JSON.stringify({ v: 2, ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US", savedAt: SAVED_AT, presentation: readyPresentation }),
      JSON.stringify({ v: 1, ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US", savedAt: expired, presentation: readyPresentation }),
      JSON.stringify({ v: 1, ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US", savedAt: SAVED_AT, presentation: readyPresentation, snapshot: { walletAddress: ACCOUNT } }),
      JSON.stringify({ v: 1, ownerKey: "Bearer secret-token", subject: SUBJECT, smartAccount: ACCOUNT, region: "US", savedAt: SAVED_AT, presentation: readyPresentation }),
      JSON.stringify({ v: 1, ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US", savedAt: SAVED_AT, presentation: { ...readyPresentation, otp: "123456" } }),
    ];

    for (const raw of cases) {
      const storage = memoryStorage({ [key]: raw });
      expect(
        readHomeBalancesPresentation(
          () => storage,
          { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
          NOW,
        ),
      ).toBeNull();
    }

    const storage = memoryStorage();
    writeHomeBalancesPresentation(
      () => storage,
      {
        ownerKey: OWNER,
        subject: SUBJECT,
        smartAccount: ACCOUNT,
        region: "US",
      },
      readyPresentation,
      NOW,
    );
    expect(
      readHomeBalancesPresentation(
        () => storage,
        { ownerKey: "home-user-b", subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
        NOW,
      ),
    ).toBeNull();
    expect(
      readHomeBalancesPresentation(
        () => storage,
        { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "BR" },
        NOW,
      ),
    ).toBeNull();
  });

  test("misses when one owner has two smart-account records for the same region", () => {
    const storage = memoryStorage();
    writeHomeBalancesPresentation(
      () => storage,
      {
        ownerKey: OWNER,
        subject: SUBJECT,
        smartAccount: ACCOUNT,
        region: "US",
      },
      readyPresentation,
      NOW,
    );
    writeHomeBalancesPresentation(
      () => storage,
      {
        ownerKey: OWNER,
        subject: SUBJECT,
        smartAccount: OTHER_ACCOUNT,
        region: "US",
      },
      { ...readyPresentation, displayTotal: "$99.00" },
      NOW,
    );

    expect(
      readHomeBalancesPresentation(() => storage, { ownerKey: OWNER, region: "US" }, NOW),
    ).toBeNull();
  });

  test("wipes every home.balances.v1 key and leaves other storage alone", () => {
    const key = homeBalancesPresentationCacheKey({
      subject: SUBJECT,
      smartAccount: ACCOUNT,
      region: "US",
    });
    const storage = memoryStorage({
      [key]: "ready",
      [`${homeBalancesPresentationCachePrefix}other`]: "stale",
      "home.country.v1": "US",
    });

    expect(clearHomeBalancesPresentationCache(() => storage)).toBe(true);
    expect(storage.snapshot()).toEqual({ "home.country.v1": "US" });
  });

  test("deletes the current key and fails open when storage throws", () => {
    const storage = memoryStorage();
    writeHomeBalancesPresentation(
      () => storage,
      {
        ownerKey: OWNER,
        subject: SUBJECT,
        smartAccount: ACCOUNT,
        region: "US",
      },
      readyPresentation,
      NOW,
    );
    expect(
      deleteHomeBalancesPresentation(
        () => storage,
        { subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
      ),
    ).toBe(true);
    expect(storage.length).toBe(0);

    const blocked = () => {
      throw new DOMException("Storage access blocked", "SecurityError");
    };
    expect(readHomeBalancesPresentation(blocked, { ownerKey: OWNER, region: "US" }, NOW)).toBeNull();
    expect(
      writeHomeBalancesPresentation(
        blocked,
        {
          ownerKey: OWNER,
          subject: SUBJECT,
          smartAccount: ACCOUNT,
          region: "US",
        },
        readyPresentation,
        NOW,
      ),
    ).toBe(false);
    expect(clearHomeBalancesPresentationCache(blocked)).toBe(false);
  });

  test("paints cache only over a loading live presentation for the matching owner", () => {
    const storage = memoryStorage();
    writeHomeBalancesPresentation(
      () => storage,
      {
        ownerKey: OWNER,
        subject: SUBJECT,
        smartAccount: ACCOUNT,
        region: "GLOBAL",
      },
      readyPresentation,
      NOW,
    );

    expect(
      resolvePaintedHomeBalances({
        ownerKey: OWNER,
        region: "GLOBAL",
        live: { status: "loading", displayTotal: null, statusLabel: "Updating…", items: [] },
        getStorage: () => storage,
        now: NOW,
      }),
    ).toEqual({
      ...readyPresentation,
      statusLabel: "Updating…",
      revalidating: true,
    });
    expect(
      resolvePaintedHomeBalances({
        ownerKey: null,
        region: "GLOBAL",
        live: { status: "loading", displayTotal: null, items: [] },
        getStorage: () => storage,
        now: NOW,
      }),
    ).toEqual({ status: "loading", displayTotal: null, items: [] });
    expect(
      resolvePaintedHomeBalances({
        ownerKey: OWNER,
        region: "GLOBAL",
        live: { status: "unavailable", displayTotal: null, items: [] },
        getStorage: () => storage,
        now: NOW,
      }),
    ).toEqual({ status: "unavailable", displayTotal: null, items: [] });
    expect(
      resolvePaintedHomeBalances({
        ownerKey: OWNER,
        region: "GLOBAL",
        live: { status: "ready", displayTotal: "$4.00", items: [] },
        getStorage: () => storage,
        now: NOW,
      }),
    ).toEqual({ status: "ready", displayTotal: "$4.00", items: [] });
  });
});
