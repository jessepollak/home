import { describe, expect, test } from "bun:test";
import type { HomeAssetBalancesPresentation } from "@/shared/portfolio/present-home-balances";
import {
  clearHomeBalancesPresentationCache,
  deleteHomeBalancesPresentation,
  homeBalancesPresentationCacheKey,
  homeBalancesPresentationCachePrefix,
  homeBalancesPresentationCacheTtlMs,
  homeBalancesPresentationSemanticVersion,
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
  totalStatus: "complete",
  items: [
    {
      id: "usdc",
      assetKey: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
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

    const stored = JSON.parse(
      Object.values(storage.snapshot())[0] ?? "null",
    ) as Record<string, unknown>;
    expect(stored.presentationSemantics).toBe(
      homeBalancesPresentationSemanticVersion,
    );
    expect(stored.presentation).toMatchObject({ totalStatus: "complete" });

    expect(
      readHomeBalancesPresentation(
        () => storage,
        { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
        NOW,
      ),
    ).toEqual({
      status: "ready",
      displayTotal: "$12.34",
      totalStatus: "complete",
      statusLabel: "Choose a country in Account to set how money is shown",
      items: readyPresentation.items,
    });
  });

  test("round-trips an unpriced cash token quantity", () => {
    const storage = memoryStorage();
    const presentation: HomeAssetBalancesPresentation = {
      status: "ready",
      displayTotal: "—",
      totalStatus: "partial",
      statusLabel: "Unavailable",
      items: [
        {
          id: "cash:idrx",
          group: "cash",
          name: "Indonesian rupiah",
          displayBalance: "2,500.00 IDRX",
          currencyCode: "IDR",
          tone: "muted",
        },
      ],
    };

    expect(
      writeHomeBalancesPresentation(
        () => storage,
        { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
        presentation,
        NOW,
      ),
    ).toBe(true);
    expect(
      readHomeBalancesPresentation(
        () => storage,
        { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
        NOW,
      ),
    ).toEqual(presentation);
  });

  test("keeps cached EURC through an unknown read, removes confirmed zero, and adds new ready holdings", () => {
    const storage = memoryStorage();
    const cached: HomeAssetBalancesPresentation = {
      status: "ready",
      displayTotal: "$25.00",
      items: [
        ...readyPresentation.items,
        {
          id: "asset:fixture-eurc",
          group: "asset",
          name: "Euro",
          detail: "EURC",
          displayBalance: "25.00 EURC",
          currencyCode: "EUR",
        },
      ],
    };
    writeHomeBalancesPresentation(
      () => storage,
      { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
      cached,
      NOW,
    );

    const liveUnknown: HomeAssetBalancesPresentation = {
      status: "ready",
      displayTotal: "$12.34",
      items: [
        ...readyPresentation.items,
        {
          id: "asset:new",
          group: "asset",
          name: "New holding",
          detail: "NEW",
          displayBalance: "1.0000 NEW",
        },
      ],
      incompleteItemIds: ["asset:fixture-eurc", "asset:never-seen"],
    };
    const reconciled = resolvePaintedHomeBalances({
      ownerKey: OWNER,
      subject: SUBJECT,
      smartAccount: ACCOUNT,
      region: "US",
      live: liveUnknown,
      getStorage: () => storage,
      now: NOW,
    });
    const reconciledItems = [
      readyPresentation.items[0],
      {
        id: "asset:fixture-eurc",
        group: "asset" as const,
        name: "Euro",
        detail: "EURC",
        displayBalance: "25.00 EURC",
        displayContext: "Updating…",
        currencyCode: "EUR",
      },
      liveUnknown.items[1],
    ];
    expect(reconciled.items).toEqual(reconciledItems);
    expect(
      writeHomeBalancesPresentation(
        () => storage,
        { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
        reconciled,
        NOW + 1,
      ),
    ).toBe(false);
    expect(
      readHomeBalancesPresentation(
        () => storage,
        { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
        NOW + 1,
      ),
    ).toEqual(cached);

    const liveReady: HomeAssetBalancesPresentation = {
      status: "ready",
      displayTotal: "$13.34",
      items: [
        ...readyPresentation.items,
        {
          id: "asset:fixture-eurc",
          group: "asset",
          name: "Euro",
          detail: "EURC",
          displayBalance: "1.00 EURC",
          currencyCode: "EUR",
        },
        liveUnknown.items[1],
      ],
    };
    expect(
      resolvePaintedHomeBalances({
        ownerKey: OWNER,
        subject: SUBJECT,
        smartAccount: ACCOUNT,
        region: "US",
        live: liveReady,
        getStorage: () => storage,
        now: NOW,
      }),
    ).toBe(liveReady);

    const confirmedZero: HomeAssetBalancesPresentation = {
      status: "ready",
      displayTotal: "$12.34",
      items: readyPresentation.items,
    };
    expect(
      resolvePaintedHomeBalances({
        ownerKey: OWNER,
        subject: SUBJECT,
        smartAccount: ACCOUNT,
        region: "US",
        live: confirmedZero,
        getStorage: () => storage,
        now: NOW,
      }),
    ).toBe(confirmedZero);
  });

  test("never reconciles live-ready membership across owner, subject, account, or region", () => {
    const storage = memoryStorage();
    const cached: HomeAssetBalancesPresentation = {
      status: "ready",
      displayTotal: "$25.00",
      items: [
        ...readyPresentation.items,
        {
          id: "asset:cached-local",
          group: "asset",
          name: "Cached local currency",
          displayBalance: "25.00 LCLX",
        },
      ],
    };
    writeHomeBalancesPresentation(
      () => storage,
      { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
      cached,
      NOW,
    );
    const live: HomeAssetBalancesPresentation = {
      ...readyPresentation,
      unavailableItemIds: ["asset:cached-local"],
    };

    for (const lookup of [
      { ownerKey: "other-owner", subject: SUBJECT, smartAccount: ACCOUNT, region: "US" as const },
      { ownerKey: OWNER, subject: "other-subject", smartAccount: ACCOUNT, region: "US" as const },
      { ownerKey: OWNER, subject: SUBJECT, smartAccount: OTHER_ACCOUNT, region: "US" as const },
      { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "GLOBAL" as const },
    ]) {
      expect(
        resolvePaintedHomeBalances({
          ...lookup,
          live,
          getStorage: () => storage,
          now: NOW,
        }),
      ).toBe(live);
    }
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

  test("misses an otherwise valid record with legacy formatted-row semantics", () => {
    const key = homeBalancesPresentationCacheKey({
      subject: SUBJECT,
      smartAccount: ACCOUNT,
      region: "US",
    });
    const storage = memoryStorage({
      [key]: JSON.stringify({
        v: 1,
        ownerKey: OWNER,
        subject: SUBJECT,
        smartAccount: ACCOUNT,
        region: "US",
        savedAt: SAVED_AT,
        presentation: readyPresentation,
      }),
    });

    expect(
      readHomeBalancesPresentation(
        () => storage,
        { ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US" },
        NOW,
      ),
    ).toBeNull();
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
      JSON.stringify({ v: 1, presentationSemantics: homeBalancesPresentationSemanticVersion, ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US", savedAt: expired, presentation: readyPresentation }),
      JSON.stringify({ v: 1, presentationSemantics: homeBalancesPresentationSemanticVersion, ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US", savedAt: SAVED_AT, presentation: readyPresentation, snapshot: { walletAddress: ACCOUNT } }),
      JSON.stringify({ v: 1, presentationSemantics: homeBalancesPresentationSemanticVersion, ownerKey: "Bearer secret-token", subject: SUBJECT, smartAccount: ACCOUNT, region: "US", savedAt: SAVED_AT, presentation: readyPresentation }),
      JSON.stringify({ v: 1, presentationSemantics: homeBalancesPresentationSemanticVersion, ownerKey: OWNER, subject: SUBJECT, smartAccount: ACCOUNT, region: "US", savedAt: SAVED_AT, presentation: { ...readyPresentation, otp: "123456" } }),
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
