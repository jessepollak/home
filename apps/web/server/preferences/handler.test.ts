import { expect, spyOn, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseCountryPreferenceErrorResponse } from "@/shared/account/contracts/country-preference";
import { CustomerResolver } from "@/server/customers/resolve";
import type { SqlExecutor } from "@/server/db/sql";
import { CountryPreferenceStore, readCountryPreference, readCountryPreferenceForRender } from "./country";
import { createCountryPreferenceHandler, createCountryPreferenceReadHandler } from "./handler";

const session: VerifiedAccountSession = { accountProvider: "cdp-embedded", user: { subject: "owner-A" }, smartAccount: null };
const request = (body?: unknown) => new Request("https://home.test/api/account/country-preference?subject=owner-B", {
  method: body === undefined ? "GET" : "PUT",
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
}

test("currency-only writes need an authenticated session but no country-offering or wallet verification", async () => {
  const handler = createCountryPreferenceHandler({
    authorize: async () => session,
    regionOffered: async () => { throw new Error("Must not check country for a currency choice"); },
    write: async (owner, input) => {
      expect(owner).toEqual(session);
      return { regionId: null, displayCurrency: input.displayCurrency ?? null };
    },
  });
  const response = await handler(request({ version: 2, displayCurrency: "EUR", subject: "owner-B" }));
  expect(response.status).toBe(200);
  privateResponse(response);
  expect(await response.json()).toEqual({ version: 2, regionId: null, displayCurrency: "EUR" });
});

test("unsupported currency and country return distinct actionable errors", async () => {
  const handler = createCountryPreferenceHandler({
    authorize: async () => session,
    regionOffered: async () => false,
    write: async () => { throw new Error("Invalid preferences must not persist"); },
  });
  for (const [body, message] of [
    [{ version: 2, displayCurrency: "ZZZ" }, "Choose a supported currency."],
    [{ version: 2, displayCurrency: null }, "Choose a supported currency."],
    [{ version: 2, regionId: "US" }, "Choose a supported country."],
    [{ version: 2, regionId: "XX" }, "Choose a supported country."],
    [{ version: 2 }, "Choose a supported country."],
  ] as const) {
    const response = await handler(request(body));
    expect(response.status).toBe(400);
    privateResponse(response);
    expect(parseCountryPreferenceErrorResponse(await response.json())).toEqual({ error: { code: "COUNTRY_PREFERENCE_INVALID", message } });
  }
});

test("read and write storage failures return private 503 without leaking details", async () => {
  const read = createCountryPreferenceReadHandler({ authorize: async () => session, read: async () => { throw new Error("database-secret"); } });
  const write = createCountryPreferenceHandler({ authorize: async () => session, write: async () => { throw new Error("database-secret"); } });
  for (const response of [await read(request()), await write(request({ version: 2, displayCurrency: "USD" }))]) {
    expect(response.status).toBe(503);
    privateResponse(response);
    expect(parseCountryPreferenceErrorResponse(await response.json())?.error.code).toBe("COUNTRY_PREFERENCE_UNAVAILABLE");
  }
});

test("unauthenticated requests cannot read or change preferences", async () => {
  const authorize = async () => Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in." } }, { status: 401 });
  const read = createCountryPreferenceReadHandler({ authorize, read: async () => { throw new Error("Must not read"); } });
  const write = createCountryPreferenceHandler({ authorize, write: async () => { throw new Error("Must not write"); } });
  expect((await read(request())).status).toBe(401);
  expect((await write(request({ version: 2, displayCurrency: "USD" }))).status).toBe(401);
});


test("a timed-out preference read supplies no render seed", async () => {
  const controller = new AbortController();
  const deadline = spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const sql: SqlExecutor = {
    query: () => new Promise(() => {}),
    transaction: async () => { throw new Error("Reads must not resolve or create a customer"); },
  };
  try {
    const store = new CountryPreferenceStore(sql, new CustomerResolver(sql));
    const reading = readCountryPreferenceForRender(session, store);
    controller.abort(new Error("Read deadline exceeded"));
    expect(await reading).toBeNull();
  } finally {
    deadline.mockRestore();
  }
});

test("a missing runtime store returns empty preferences for GET and render", async () => {
  expect(await readCountryPreference(session, null)).toBeNull();
  expect(await readCountryPreferenceForRender(session, null)).toEqual({ regionId: null, displayCurrency: null });
  const handler = createCountryPreferenceReadHandler({ authorize: async () => session,
    read: (owner) => readCountryPreference(owner, null) });
  const response = await handler(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ version: 2, regionId: null, displayCurrency: null });
});
