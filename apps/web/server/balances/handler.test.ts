import { describe, expect, test } from "bun:test";
import { BalancesResponseError, parseBalancesSnapshot } from "@/shared/balances/contract";
import { balancesSnapshotFixture, borrowPosition, buildBalancesSnapshotFixture, priced, unavailableBalance } from "@/shared/balances/fixtures";
import type { BalancesSession, BalancesSnapshot } from "@/shared/balances/types";
import { createBalancesHandler } from "./handler";
import { assembleBalancesSnapshot } from "./snapshot";

const verified = {
  user: { subject: "user-1" },
  smartAccount: {
    address: balancesSnapshotFixture.owner.address,
    chainId: 8453 as const,
  },
  accountProvider: "cdp-embedded" as const,
};

describe("balances handler", () => {
  test.each([
    [
      "invalid region",
      new Request("https://home.test/api/balances"),
      async () => verified,
      400,
      "INVALID_REGION",
    ],
    [
      "authorization relay",
      new Request("https://home.test/api/balances?region=US"),
      async () => Response.json({
        error: {
          code: "UNAUTHORIZED",
          message: "Sign in.",
        },
      }, { status: 401 }),
      401,
      "UNAUTHORIZED",
    ],
    [
      "missing smart account",
      new Request("https://home.test/api/balances?region=US"),
      async () => ({
        ...verified,
        smartAccount: null,
      }),
      503,
      "SMART_ACCOUNT_UNAVAILABLE",
    ],
  ])("handles %s", async (_name, request, authorize, status, code) => {
    const handler = createBalancesHandler({
      authorize: authorize as never,
      readBalances: async () => balancesSnapshotFixture,
    });
    const response = await handler(request as Request);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({
      error: { code },
    });
  });

  test("maps read failures to 502 and emits one source event", async () => {
    const events: unknown[] = [];
    const handler = createBalancesHandler({
      authorize: async () => verified,
      readBalances: async () => {
        throw new Error("down");
      },
      log: (event) => events.push(event),
    });

    const response = await handler(
      new Request("https://home.test/api/balances?region=US"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "BALANCES_UNAVAILABLE" },
    });
    expect(events).toEqual([{
      kind: "portfolio-balance-source",
      route: "/api/balances",
      source: "configured-base-rpc",
      stage: "inventory",
      outcome: "unavailable",
      reason: "read-failed",
    }]);
  });

  test.each([
    ["throwing", () => { throw new Error("sink failed"); }],
    ["rejecting", () => Promise.reject(new Error("sink failed"))],
  ])("returns the same 502 when the read-failure log is %s", async (_kind, log) => {
    const handler = createBalancesHandler({
      authorize: async () => verified,
      readBalances: async () => { throw new Error("down"); },
      log,
    });
    const response = await handler(new Request("https://home.test/api/balances?region=US"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "BALANCES_UNAVAILABLE", message: "Balances are temporarily unavailable." },
    });
  });
  test("rejects another owner's snapshot with a boundary event", async () => {
    const events: unknown[] = [];
    const handler = createBalancesHandler({
      authorize: async () => verified,
      readBalances: async () => ({
        ...balancesSnapshotFixture,
        owner: {
          ...balancesSnapshotFixture.owner,
          address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      }),
      log: (event) => events.push(event),
    });

    const response = await handler(
      new Request("https://home.test/api/balances?region=US"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "BALANCES_UNAVAILABLE" },
    });
    expect(events).toEqual([{
      kind: "balances-contract",
      route: "/api/balances",
      reason: "invalid-snapshot",
    }]);
  });

  test("rejects another region's snapshot with a boundary event", async () => {
    const events: unknown[] = [];
    const handler = createBalancesHandler({
      authorize: async () => verified,
      readBalances: async () => balancesSnapshotFixture,
      log: (event) => events.push(event),
    });

    const response = await handler(
      new Request("https://home.test/api/balances?region=DE"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "BALANCES_UNAVAILABLE" },
    });
    expect(events).toEqual([{
      kind: "balances-contract",
      route: "/api/balances",
      reason: "invalid-snapshot",
    }]);
  });

  test("rejects malformed assembled totals without blaming an inventory source", async () => {
    const events: unknown[] = [];
    const handler = createBalancesHandler({
      authorize: async () => verified,
      readBalances: async (owner, region) => {
        const assembled = assembleBalancesSnapshot({
          owner,
          region,
          read: {
            block: balancesSnapshotFixture.block,
            observedAt: balancesSnapshotFixture.fetchedAt,
            holdings: [],
            coverage: balancesSnapshotFixture.coverage,
          },
          borrow: balancesSnapshotFixture.borrow,
          holdings: balancesSnapshotFixture.holdings,
        });
        return {
          ...assembled,
          totals: {
            ...assembled.totals,
            net: { ...assembled.totals.net, negative: "private-secret" as never },
          },
        };
      },
      log: (event) => events.push(event),
    });

    const response = await handler(new Request("https://home.test/api/balances?region=US"));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "BALANCES_UNAVAILABLE" },
    });
    expect(events).toEqual([{
      kind: "balances-contract",
      route: "/api/balances",
      reason: "invalid-snapshot",
    }]);
  });

  test("serves an assembled reader snapshot the client parser accepts", async () => {
    const handler = createBalancesHandler({
      authorize: async () => verified,
      readBalances: async (owner, region) => assembleBalancesSnapshot({
        owner,
        region,
        read: {
          block: balancesSnapshotFixture.block,
          observedAt: balancesSnapshotFixture.fetchedAt,
          holdings: [],
          coverage: balancesSnapshotFixture.coverage,
        },
        borrow: balancesSnapshotFixture.borrow,
        holdings: balancesSnapshotFixture.holdings,
      }),
    });

    const response = await handler(
      new Request("https://home.test/api/balances?region=US"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(parseBalancesSnapshot(body, {
      subject: "user-1",
      smartAccountAddress: verified.smartAccount.address,
      chainId: 8453,
    }, "US")).toEqual(body);
  });

  test("attempts subscription once per address without delaying or failing reads", async () => {
    let attempts = 0;
    const handler = createBalancesHandler({
      authorize: async () => verified,
      readBalances: async (_owner, region) => buildBalancesSnapshotFixture({ region }),
      ensureAddressSubscribed: async () => { attempts += 1; throw new Error("not configured"); },
    });
    const first = await handler(new Request("https://home.test/api/balances?region=US"));
    const second = await handler(new Request("https://home.test/api/balances?region=DE"));
    await Promise.resolve();
    expect(attempts).toBe(1);
    expect([first.status, second.status]).toEqual([200, 200]);
  });

  test("returns the snapshot with private response headers", async () => {
    const handler = createBalancesHandler({
      authorize: async () => verified,
      readBalances: async () => balancesSnapshotFixture,
    });
    const response = await handler(
      new Request("https://home.test/api/balances?region=US"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(balancesSnapshotFixture);
    expect(response.headers.get("cache-control"))
      .toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("vary"))
      .toBe("Authorization, X-Home-Account-Provider");
  });

  const session: BalancesSession = {
    subject: "user-1", smartAccountAddress: verified.smartAccount.address, chainId: 8453,
  };

  async function servedSnapshot(fixture: BalancesSnapshot) {
    const snapshot = assembleBalancesSnapshot({
      owner: fixture.owner.address, region: fixture.region, holdings: fixture.holdings, borrow: fixture.borrow,
      read: { block: fixture.block, observedAt: fixture.fetchedAt, holdings: [], coverage: fixture.coverage },
    });
    const handler = createBalancesHandler({
      authorize: async () => verified, readBalances: async () => snapshot,
    });
    const response = await handler(new Request(`https://home.test/api/balances?region=${fixture.region}`));
    expect(response.status).toBe(200);
    const body: BalancesSnapshot = await response.json();
    return { body, snapshot };
  }

  test.each([
    ["complete", buildBalancesSnapshotFixture({ catalog: [] }), "complete"],
    ["partial/unavailable", balancesSnapshotFixture, "partial"],
    ["unavailable total", buildBalancesSnapshotFixture({
      registry: { toshi: { balance: unavailableBalance, value: { status: "unavailable" } } },
    }), "unavailable"],
    ["GLOBAL no-quote-currency", buildBalancesSnapshotFixture({ region: "GLOBAL" }), "no-quote-currency"],
    ["borrow position", buildBalancesSnapshotFixture({
      borrow: { coverage: "complete", positions: [borrowPosition({
        collateralBaseUnits: "100000", collateralValue: priced("USD", "10000"),
        debtBaseUnits: "30010000", debtValue: priced("USD", "3001"),
      })] },
    }), "complete"],
  ] as const)("round-trips real %s handler output through the wire contract", async (_name, fixture, totalStatus) => {
    const { body, snapshot } = await servedSnapshot(fixture);
    const parsed = parseBalancesSnapshot(body, session, fixture.region);
    expect(snapshot.total.status).toBe(totalStatus);
    expect(parsed.total.status).toBe(totalStatus);
    expect(parsed).toEqual(snapshot);
  });

  test("rejects malformed mutations of real handler output after wire serialization", async () => {
    const complete = (await servedSnapshot(buildBalancesSnapshotFixture({ catalog: [] }))).body;
    const partial = (await servedSnapshot(balancesSnapshotFixture)).body;
    const mutations: { name: string; original: BalancesSnapshot; change: (wire: BalancesSnapshot) => void; detail?: RegExp }[] = [
      { name: "wrong version", original: complete, change: (wire) => { Object.assign(wire, { version: 0 }); } },
      { name: "dropped registry holding", original: complete, change: (wire) => {
        wire.holdings = wire.holdings.filter((h) => h.id !== "usdc");
      } },
      { name: "complete registry coverage with unavailable holding", original: partial, change: (wire) => {
        wire.coverage.registry = "complete";
      } },
      { name: "unavailable balance retaining priced value", original: partial, change: (wire) => {
        const holding = wire.holdings.find((h) => h.id === "eth");
        if (!holding) throw new Error("Missing ETH fixture holding");
        Object.assign(holding, { balance: { status: "unavailable", baseUnits: null } });
      }, detail: /holdings\./ },
      { name: "partial total without value", original: partial, change: (wire) => {
        wire.total.value = null;
      }, detail: /\btotal\b/ },
      { name: "missing net sign", original: complete, change: (wire) => {
        Reflect.deleteProperty(wire.totals.net, "negative");
      } },
      { name: "complete net with partial borrow coverage", original: complete, change: (wire) => {
        wire.borrow.coverage = "partial";
      } },
    ];
    for (const { name, original, change, detail } of mutations) {
      const wire: BalancesSnapshot = JSON.parse(JSON.stringify(original));
      change(wire);
      const body = JSON.parse(JSON.stringify(wire));
      expect(() => parseBalancesSnapshot(body, session, original.region), name).toThrow(BalancesResponseError);
      if (detail) expect(() => parseBalancesSnapshot(body, session, original.region), name).toThrow(detail);
    }
  });
});
