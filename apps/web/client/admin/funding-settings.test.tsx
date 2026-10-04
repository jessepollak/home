import "@/client/account/dom-test-harness";

import { afterEach, expect, mock, test } from "bun:test";
import { useContext } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { FundingCorridorView, FundingOfferingView } from "@/shared/funding/offering";
import { isRecord } from "@/shared/guards";
import { parseFundingSettings } from "@/shared/operator-settings/contract";

const actualNavigation = await import("next/navigation");
await mock.module("next/navigation", () => ({
  ...actualNavigation,
  useRouter: () => useContext(AppRouterContext),
}));

const { FundingSettings, FundingSettingsUnavailable } = await import("./funding-settings");

const operator = "0x1111111111111111111111111111111111111111" as const;

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");

const nativeFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = nativeFetch;
});

function corridor(overrides: Partial<FundingCorridorView> & Pick<FundingCorridorView, "providerId" | "region" | "direction">): FundingCorridorView {
  const { providerId, region, direction } = overrides;
  return {
    key: `${providerId}:${region}:${direction}`,
    providerName: providerId === "peer" ? "Peer" : "Coinbase",
    regionName: region === "US" ? "United States" : "Mexico",
    currency: region === "US" ? "USD" : "MXN",
    paymentMethods: ["Bank transfer"],
    connection: "connected",
    missingEnv: [],
    credentials: [],
    selected: false,
    offered: false,
    confirmedBy: null,
    newSinceSave: false,
    ...overrides,
  };
}

function savedView(corridors: FundingCorridorView[]): FundingOfferingView {
  return {
    source: "saved",
    revision: 7,
    updatedAt: "2026-09-20T15:00:00.000Z",
    updatedBy: "0x1111111111111111111111111111111111111111",
    corridors,
    providers: [
      { providerId: "coinbase", displayName: "Coinbase", credentials: [{ name: "COINBASE_ONRAMP_KEY", state: "set" }] },
      { providerId: "peer", displayName: "Peer", credentials: [{ name: "PEER_API_KEY", state: "unset" }] },
    ],
    legacy: [{ name: "PEER_OFFRAMP_ENABLED", state: "unset" }],
    unknownSaved: [],
  };
}

const onramp = corridor({ providerId: "coinbase", region: "US", direction: "onramp", selected: true, offered: true, confirmedBy: "Live $1 test on Sep 18" });
const mexicoOnramp = corridor({ providerId: "coinbase", region: "MX", direction: "onramp", paymentMethods: ["SPEI", "Card"] });
const peerOfframp = corridor({ providerId: "peer", region: "US", direction: "offramp", connection: "not-connected", missingEnv: ["PEER_API_KEY"], credentials: [{ name: "PEER_API_KEY", state: "unset" }] });

function testRouter(refreshes: number[]): AppRouterInstance {
  return {
    bfcacheId: "test",
    back() {}, forward() {}, prefetch() {}, push() {}, replace() {},
    refresh() { refreshes.push(refreshes.length + 1); },
  };
}

function renderSettings(view: FundingOfferingView) {
  const refreshes: number[] = [];
  const router = testRouter(refreshes);
  const page = render(
    <AppRouterContext.Provider value={router}>
      <FundingSettings view={view} operator={operator} />
    </AppRouterContext.Provider>,
  );
  return { page, refreshes };
}

function isBodyFactory(value: unknown): value is (init: RequestInit | undefined) => unknown {
  return typeof value === "function";
}

function recordFetch(status: number, body: unknown | ((init: RequestInit | undefined) => unknown)) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    const payload = isBodyFactory(body) ? body(init) : body;
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }, { preconnect: nativeFetch.preconnect });
  return requests;
}

function deferredFetch() {
  const requests: RequestInit[] = [];
  const pending: Array<{ resolve: (response: Response) => void; reject: (reason: unknown) => void }> = [];
  globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    return new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject }); });
  }, { preconnect: nativeFetch.preconnect });
  return {
    requests,
    resolve(response: Response, index = 0) {
      const request = pending[index];
      if (!request) throw new Error("No save request was sent");
      request.resolve(response);
    },
    reject(reason: unknown, index = 0) {
      const request = pending[index];
      if (!request) throw new Error("No save request was sent");
      request.reject(reason);
    },
  };
}

const savedResponse = {
  version: 1,
  domain: "funding",
  settings: { value: { corridors: [] }, revision: 8, source: "stored", updatedAt: "2026-09-21T10:00:00.000Z", updatedBy: "0x1111111111111111111111111111111111111111" },
};

function storedResponse(corridors: Array<{ providerId: string; region: string; direction: "onramp" | "offramp"; offered: boolean }>, revision = 8) {
  return {
    version: 1,
    domain: "funding",
    settings: { value: { corridors }, revision, source: "stored", updatedAt: "2026-09-21T10:00:00.000Z", updatedBy: "0x1111111111111111111111111111111111111111" },
  };
}
function echoStored(init: RequestInit | undefined) {
  const parsed: unknown = JSON.parse(String(init?.body ?? "{}"));
  if (!isRecord(parsed)) throw new Error("expected the save request body to be a JSON object");
  const settings = parseFundingSettings(parsed.value);
  if (!settings) throw new Error("expected the save request to carry valid funding settings");
  const revision = typeof parsed.expectedRevision === "number" ? parsed.expectedRevision + 1 : 8;
  return storedResponse(settings.corridors, revision);
}

function readSaveRequest(init: RequestInit | undefined) {
  const parsed: unknown = JSON.parse(String(init?.body));
  if (!isRecord(parsed)) throw new Error("expected the save request body to be a JSON object");
  const value = parseFundingSettings(parsed.value);
  if (!value) throw new Error("expected the save request to carry valid funding settings");
  return { ...parsed, version: parsed.version, value, operator: parsed.operator, expectedRevision: parsed.expectedRevision };
}

for (const connection of ["connected", "not-connected"] as const) {
  for (const selected of [true, false]) {
    test(`${connection} and ${selected ? "on" : "off"} shows the selection and allows only safe changes`, () => {
      const peer = { ...peerOfframp, connection, selected, offered: selected && connection === "connected" };
      const { page } = renderSettings(savedView([peer]));
      const toggle = page.getByRole("switch", { name: "Cash out with Peer in United States" });

      expect(toggle.getAttribute("aria-checked")).toBe(String(selected));
      const disabled = toggle.getAttribute("aria-disabled") === "true" || toggle.hasAttribute("disabled") || toggle.hasAttribute("data-disabled");
      expect(disabled).toBe(connection === "not-connected" && !selected);
      const description = document.getElementById(toggle.getAttribute("aria-describedby") ?? "")?.textContent;
      if (connection === "not-connected") {
        expect(description).toContain("Not connected");
        expect(description).toContain("Missing PEER_API_KEY");
        if (selected) expect(description).toContain("On when credentials are set");
      } else {
        expect(description).toContain(selected ? "On" : "Connected, off");
      }
    });
  }
}

test("turning a corridor on requires review and does not save until Confirm", async () => {
  const requests = recordFetch(200, echoStored);
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp, peerOfframp]));

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));

  expect(page.getByRole("heading", { name: "Review before turning on" })).toBeTruthy();
  expect(page.getByText("Customers in Mexico can add money with Coinbase via SPEI or Card.")).toBeTruthy();
  expect(page.getByText("Evidence: none recorded")).toBeTruthy();
  expect(requests).toHaveLength(0);

  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

  await waitFor(() => expect(page.getByRole("status").textContent).toBe("Saved."));
  expect(requests).toHaveLength(1);
  expect(readSaveRequest(requests[0]?.init)).toEqual({
    version: 1,
    expectedRevision: 7,
    operator,
    value: { corridors: [
      { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
      { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
      { providerId: "peer", region: "US", direction: "offramp", offered: false },
    ] },
  });
  expect(refreshes).toHaveLength(1);
});

test("a disconnected off corridor cannot be turned on or saved on by another change", async () => {
  const requests = recordFetch(200, echoStored);
  const { page } = renderSettings(savedView([onramp, peerOfframp]));
  const disconnected = page.getByRole("switch", { name: "Cash out with Peer in United States" });

  fireEvent.click(disconnected);
  fireEvent.keyDown(disconnected, { key: " " });
  fireEvent.keyUp(disconnected, { key: " " });
  expect(disconnected.getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  expect(page.queryByRole("heading", { name: "On without credentials" })).toBeNull();
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

  expect(requests).toHaveLength(1);
  expect(readSaveRequest(requests[0]?.init).value.corridors).toContainEqual({ providerId: "peer", region: "US", direction: "offramp", offered: false });
});

test("a disconnected saved-on corridor can be paused, named in review, and saved off", async () => {
  const requests = recordFetch(200, echoStored);
  const disconnected = { ...peerOfframp, selected: true, offered: false };
  const { page } = renderSettings(savedView([onramp, disconnected]));
  const toggle = page.getByRole("switch", { name: "Cash out with Peer in United States" });

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(document.getElementById(toggle.getAttribute("aria-describedby") ?? "")?.textContent).toContain("Pauses when saved");
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  expect(page.getByRole("heading", { name: "Pause 1 corridor?" })).toBeTruthy();
  const paused = page.getByRole("region", { name: "Pausing" }).textContent;
  expect(paused).toContain("Peer · Cash out · United States");
  expect(paused).toContain("This corridor stays off and won't become available when its credentials return.");
  expect(paused).not.toContain("New orders stop");
  expect(page.queryByRole("heading", { name: "On without credentials" })).toBeNull();
  expect(requests).toHaveLength(0);

  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(requests).toHaveLength(1);
  expect(readSaveRequest(requests[0]?.init).value.corridors).toContainEqual({ providerId: "peer", region: "US", direction: "offramp", offered: false });
});

test("one multi-method corridor renders once and saves one parseable key", async () => {
  const requests = recordFetch(200, echoStored);
  const multiMethod = { ...onramp, paymentMethods: ["Bank transfer", "Card"] };
  const { page } = renderSettings(savedView([multiMethod]));
  expect(page.getAllByRole("switch", { name: "Add money with Coinbase in United States" })).toHaveLength(1);
  expect(page.getByText("USD · Bank transfer · Card")).toBeTruthy();

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

  expect(requests).toHaveLength(1);
  const sent = readSaveRequest(requests[0]?.init);
  const parsed = parseFundingSettings(sent.value);
  if (!parsed) throw new Error("expected funding settings to parse");
  const keys = parsed.corridors.map(({ providerId, region, direction }) => `${providerId}:${region}:${direction}`);
  expect(keys).toEqual(["coinbase:US:onramp"]);
  expect(new Set(keys).size).toBe(keys.length);
});

test("Back from review keeps the draft and sends nothing", () => {
  const requests = recordFetch(200, echoStored);
  const { page } = renderSettings(savedView([onramp, mexicoOnramp]));

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  fireEvent.click(page.getByRole("button", { name: "Back" }));

  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("true");
  expect(page.getByRole("status").textContent).toBe("1 unsaved change");
  expect(requests).toHaveLength(0);
});

test("pausing only confirms, then PUTs every corridor with the expected revision", async () => {
  const requests = recordFetch(200, echoStored);
  const { page } = renderSettings(savedView([onramp, mexicoOnramp, peerOfframp]));

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));

  expect(page.getByRole("heading", { name: "Pause 1 corridor?" })).toBeTruthy();
  const paused = page.getByRole("region", { name: "Pausing" }).textContent;
  expect(paused).toContain("New orders stop. Existing orders keep working — customers can still check status, withdraw, and recover funds.");
  expect(paused).not.toContain("stays off and won't become available");
  expect(requests).toHaveLength(0);

  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]?.url).toBe("/api/admin/settings/funding");
  expect(requests[0]?.init?.method).toBe("PUT");
  expect(new Headers(requests[0]?.init?.headers).get("content-type")).toBe("application/json");
  expect(readSaveRequest(requests[0]?.init)).toEqual({
    version: 1,
    expectedRevision: 7,
    operator,
    value: { corridors: [
      { providerId: "coinbase", region: "US", direction: "onramp", offered: false },
      { providerId: "coinbase", region: "MX", direction: "onramp", offered: false },
      { providerId: "peer", region: "US", direction: "offramp", offered: false },
    ] },
  });
});

test("a same-revision credential loss clears a pending activation during review before the next save", async () => {
  const requests = recordFetch(200, echoStored);
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (view: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={view} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  page.rerender(wrap(savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }])));

  expect(page.queryByRole("button", { name: "Confirm" })).toBeNull();
  const disconnected = page.getByRole("switch", { name: "Add money with Coinbase in Mexico" });
  expect(disconnected.getAttribute("aria-checked")).toBe("false");
  expect(disconnected.getAttribute("aria-disabled")).toBe("true");
  const notice = page.getByRole("alert");
  expect(notice.textContent).toContain("Coinbase · Add money · Mexico lost its credentials. Your pending change was cleared.");
  expect(requests).toHaveLength(0);
  expect(document.activeElement).toBe(notice);
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

  expect(requests).toHaveLength(1);
  expect(readSaveRequest(requests[0]?.init).value.corridors).toContainEqual({ providerId: "coinbase", region: "MX", direction: "onramp", offered: false });
});

test("a corridor that disappears then returns disconnected and stored off clears its pending activation before saving", async () => {
  const requests = recordFetch(200, echoStored);
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (view: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={view} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  page.rerender(wrap(savedView([onramp])));
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
  expect(page.queryByText(/lost its credentials/)).toBeNull();

  page.rerender(wrap(savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }])));
  const disconnected = page.getByRole("switch", { name: "Add money with Coinbase in Mexico" });
  expect(disconnected.getAttribute("aria-checked")).toBe("false");
  expect(disconnected.getAttribute("aria-disabled")).toBe("true");
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  expect(page.getByRole("alert").textContent).toContain("Coinbase · Add money · Mexico lost its credentials. Your pending change was cleared.");

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  expect(page.queryByRole("heading", { name: "On without credentials" })).toBeNull();
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(requests).toHaveLength(1);
  expect(readSaveRequest(requests[0]?.init).value.corridors).toContainEqual({ providerId: "coinbase", region: "MX", direction: "onramp", offered: false });
});

test("a revision change resets a pending activation without a credential-loss notice", () => {
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));

page.rerender(<AppRouterContext.Provider value={router}><FundingSettings view={{ ...savedView([onramp, mexicoOnramp]), revision: 8 }} operator={operator} /></AppRouterContext.Provider>);

  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
  expect(page.queryByText(/lost its credentials/)).toBeNull();
});

test("a new revision both clears unsafe activations and resets other drafts", () => {
  const extra = corridor({ providerId: "peer", region: "MX", direction: "offramp" });
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp, extra]));
  const router = testRouter(refreshes);
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("switch", { name: "Cash out with Peer in Mexico" }));

  page.rerender(<AppRouterContext.Provider value={router}><FundingSettings view={{
    ...savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }, extra]),
    revision: 8,
  }} operator={operator} /></AppRouterContext.Provider>);

  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("switch", { name: "Cash out with Peer in Mexico" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("alert").textContent).toContain("Coinbase · Add money · Mexico lost its credentials. Your pending change was cleared.");
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
});

test("a connected corridor's pending activation survives an unrelated same-revision refresh", () => {
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));

page.rerender(<AppRouterContext.Provider value={router}><FundingSettings view={{ ...savedView([onramp, mexicoOnramp]), updatedAt: "2026-09-21T15:00:00.000Z" }} operator={operator} /></AppRouterContext.Provider>);

  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("true");
  expect(page.getByRole("status").textContent).toBe("1 unsaved change");
  expect(page.queryByText(/lost its credentials/)).toBeNull();
});

test("a disconnected saved-on corridor stays on across refreshes and can still be paused", async () => {
  const requests = recordFetch(200, echoStored);
  const disconnected = { ...peerOfframp, selected: true };
  const { page, refreshes } = renderSettings(savedView([disconnected]));
  const router = testRouter(refreshes);
const wrap = (view: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={view} operator={operator} /></AppRouterContext.Provider>;

  page.rerender(wrap(savedView([])));
  page.rerender(wrap(savedView([{ ...disconnected, missingEnv: ["PEER_API_KEY", "PEER_WEBHOOK_KEY"] }])));
  let toggle = page.getByRole("switch", { name: "Cash out with Peer in United States" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(toggle.getAttribute("aria-disabled")).not.toBe("true");
  expect(page.queryByText(/lost its credentials/)).toBeNull();

  page.rerender(wrap({ ...savedView([disconnected]), revision: 8 }));
  toggle = page.getByRole("switch", { name: "Cash out with Peer in United States" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(page.queryByText(/lost its credentials/)).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(readSaveRequest(requests[0]?.init).value.corridors).toContainEqual({ providerId: "peer", region: "US", direction: "offramp", offered: false });
  expect(readSaveRequest(requests[0]?.init).expectedRevision).toBe(8);
});

test("a pending pause on a disconnected selected corridor survives a same-revision refresh", async () => {
  const requests = recordFetch(200, echoStored);
  const disconnected = { ...peerOfframp, selected: true };
  const { page, refreshes } = renderSettings(savedView([disconnected]));
  const router = testRouter(refreshes);
  fireEvent.click(page.getByRole("switch", { name: "Cash out with Peer in United States" }));

page.rerender(<AppRouterContext.Provider value={router}><FundingSettings view={savedView([{ ...disconnected, missingEnv: ["PEER_API_KEY", "PEER_WEBHOOK_KEY"] }])} operator={operator} /></AppRouterContext.Provider>);

  expect(page.getByRole("switch", { name: "Cash out with Peer in United States" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("status").textContent).toBe("1 unsaved change");
  expect(page.queryByText(/lost its credentials/)).toBeNull();
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(readSaveRequest(requests[0]?.init).value.corridors).toContainEqual({ providerId: "peer", region: "US", direction: "offramp", offered: false });
});

test("a successful save before a stale same-revision view keeps the saved-on credential-loss notice", async () => {
  recordFetch(200, echoStored);
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (view: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={view} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(page.getByRole("status").textContent).toBe("Saved.");

  page.rerender(wrap(savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }])));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("true");
  expect(page.getByRole("alert").textContent).toContain("Coinbase · Add money · Mexico lost its credentials. That corridor is saved on and will become available when its credentials are set.");
  expect(page.getByRole("alert").textContent).not.toContain("Your pending change was cleared.");
  expect(page.getByRole("status").textContent).toBe("Saved.");
});

test("a new revision replaces an in-flight save record before its late response", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (view: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={view} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  page.rerender(wrap({ ...savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }]), revision: 8 }));
  expect(page.getByText(/lost its credentials/).textContent).toContain("Your pending change was cleared.");

  await act(async () => { save.resolve(Response.json(savedResponse)); });
  expect(page.getByText(/lost its credentials/).textContent).toContain("Your pending change was cleared.");
  expect(page.getByRole("status").textContent).not.toBe("Saved.");
  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("false");
});

test("a new revision forgets the prior submission before a later credential loss", async () => {
  recordFetch(200, echoStored);
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (view: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={view} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(page.getByRole("status").textContent).toBe("Saved.");

  page.rerender(wrap({ ...savedView([onramp, mexicoOnramp]), revision: 9 }));
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  page.rerender(wrap({ ...savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }]), revision: 9 }));
  expect(page.getByText(/lost its credentials/).textContent).toContain("Your pending change was cleared.");
  expect(page.getByText(/lost its credentials/).textContent).not.toContain("saved on and will become available");
});

test("a new revision showing the saved corridor on without credentials can be paused", async () => {
  recordFetch(200, echoStored);
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  page.rerender(<AppRouterContext.Provider value={router}><FundingSettings view={{
    ...savedView([onramp, { ...mexicoOnramp, selected: true, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }]),
    revision: 8,
  }} operator={operator} /></AppRouterContext.Provider>);

  const toggle = page.getByRole("switch", { name: "Add money with Coinbase in Mexico" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(toggle.getAttribute("aria-disabled")).not.toBe("true");
  expect(page.queryByText(/lost its credentials/)).toBeNull();
  fireEvent.click(toggle);
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  expect(page.getByRole("region", { name: "Pausing" }).textContent).toContain("Coinbase · Add money · Mexico");
});

test("a submitted activation's notice changes from in-flight to saved when its response succeeds", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(save.requests).toHaveLength(1);
  expect(readSaveRequest(save.requests[0]).value.corridors).toContainEqual({ providerId: "coinbase", region: "MX", direction: "onramp", offered: true });

page.rerender(<AppRouterContext.Provider value={router}><FundingSettings view={savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }])} operator={operator} /></AppRouterContext.Provider>);
  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("alert").textContent).toContain("A save was already sent, so reload to confirm whether it is saved on.");
  await act(async () => { save.resolve(Response.json(echoStored(save.requests[0]))); });
  expect(page.getByRole("status").textContent).toBe("Saved.");
  expect(page.getByRole("alert").textContent).toContain("That corridor is saved on and will become available when its credentials are set.");
  expect(page.getByRole("alert").textContent).not.toContain("reload to confirm");
});

function startOverlappingSaves() {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (view: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={view} operator={operator} /></AppRouterContext.Provider>;
  const disconnected = { ...mexicoOnramp, connection: "not-connected" as const, missingEnv: ["COINBASE_MX_KEY"] };

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  fireEvent.click(page.getByRole("button", { name: "Confirm" }));
  page.rerender(wrap(savedView([onramp, disconnected])));
  expect(page.getByText(/lost its credentials/).textContent).toContain("A save was already sent");
  page.rerender(wrap(savedView([onramp, mexicoOnramp])));
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  fireEvent.click(page.getByRole("button", { name: "Confirm" }));
  expect(save.requests).toHaveLength(2);
  return { save, page, refreshes, wrap, disconnected };
}

test("an older success cannot close a newer review or replace its in-flight credential-loss notice", async () => {
  const { save, page, refreshes, wrap, disconnected } = startOverlappingSaves();

  await act(async () => { save.resolve(Response.json(echoStored(save.requests[0])), 0); });
  expect(page.getByRole("heading", { name: "Review before turning on" })).toBeTruthy();
  expect(page.getByRole("button", { name: "Saving…" })).toBeTruthy();
  expect(page.queryByRole("status")).toBeNull();
  expect(refreshes).toHaveLength(0);

  page.rerender(wrap(savedView([onramp, disconnected])));
  expect(page.getByText(/lost its credentials/).textContent).toContain("A save was already sent, so reload to confirm whether it is saved on.");
  expect(page.getByRole("status").textContent).not.toBe("Saved.");
  await act(async () => { save.reject(new TypeError("offline"), 1); });
  expect(page.getByText(/lost its credentials/).textContent).toContain("A save was already sent, so reload to confirm whether it is saved on.");
  expect(page.getAllByRole("alert").some((alert) => alert.textContent?.includes("We couldn't confirm whether this saved."))).toBe(true);
  expect(refreshes).toHaveLength(1);
});

for (const [outcome, response] of [
  ["saved", Response.json(savedResponse)],
  ["conflict", Response.json({ error: { code: "SETTINGS_CONFLICT" } }, { status: 409 })],
  ["unavailable", Response.json({ error: { code: "SETTINGS_UNAVAILABLE" } }, { status: 503 })],
] as const) {
  test(`a late ${outcome} from an older attempt does not change the newer uncertain result`, async () => {
    const { save, page, refreshes, wrap, disconnected } = startOverlappingSaves();
    page.rerender(wrap(savedView([onramp, disconnected])));
    await act(async () => { save.reject(new TypeError("offline"), 1); });
    expect(page.getByText(/lost its credentials/).textContent).toContain("A save was already sent, so reload to confirm whether it is saved on.");
    expect(refreshes).toHaveLength(1);

    await act(async () => { save.resolve(response, 0); });
    expect(page.getByText(/lost its credentials/).textContent).toContain("A save was already sent, so reload to confirm whether it is saved on.");
    expect(page.getAllByRole("alert").some((alert) => alert.textContent?.includes("We couldn't confirm whether this saved."))).toBe(true);
    expect(page.queryByText("Someone else changed these settings")).toBeNull();
    expect(page.queryByText("Settings can't be saved right now. Nothing changed. Try again shortly.")).toBeNull();
    expect(page.getByRole("status").textContent).not.toBe("Saved.");
    expect(refreshes).toHaveLength(1);
  });
}

test("an older conflict cannot replace a newer successful save or its credential-loss notice", async () => {
  const { save, page, refreshes, wrap, disconnected } = startOverlappingSaves();
  page.rerender(wrap(savedView([onramp, disconnected])));
  await act(async () => { save.resolve(Response.json(echoStored(save.requests[1])), 1); });
  expect(page.getByRole("status").textContent).toBe("Saved.");
  expect(page.getByText(/lost its credentials/).textContent).toContain("That corridor is saved on and will become available when its credentials are set.");

  await act(async () => { save.resolve(Response.json({ error: { code: "SETTINGS_CONFLICT" } }, { status: 409 }), 0); });
  expect(page.getByRole("status").textContent).toBe("Saved.");
  expect(page.getByText(/lost its credentials/).textContent).toContain("That corridor is saved on and will become available when its credentials are set.");
  expect(page.queryByText("Someone else changed these settings")).toBeNull();
  expect(refreshes).toHaveLength(1);
});

for (const [outcome, settle, error, wording] of [
  ["conflict", (save: ReturnType<typeof deferredFetch>) => save.resolve(Response.json({ error: { code: "SETTINGS_CONFLICT" } }, { status: 409 })), "Someone else changed these settings", "Your pending change was cleared."],
  ["unavailable", (save: ReturnType<typeof deferredFetch>) => save.resolve(Response.json({ error: { code: "SETTINGS_UNAVAILABLE" } }, { status: 503 })), "Settings can't be saved right now. Nothing changed. Try again shortly.", "Your pending change was cleared."],
  ["invalid", (save: ReturnType<typeof deferredFetch>) => save.resolve(Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 })), "These settings couldn't be saved. Reload, then review and save again.", "Your pending change was cleared."],
  ["fetch rejection", (save: ReturnType<typeof deferredFetch>) => save.reject(new TypeError("offline")), "We couldn't confirm whether this saved. Reload to check the latest settings.", "A save was already sent, so reload to confirm whether it is saved on."],
  ["unreadable JSON", (save: ReturnType<typeof deferredFetch>) => save.resolve(new Response("not-json", { status: 200 })), "We couldn't confirm whether this saved. Reload to check the latest settings.", "A save was already sent, so reload to confirm whether it is saved on."],
] as const) {
  test(`the ${outcome} result after credential loss pairs its alert with the right notice`, async () => {
    const save = deferredFetch();
    const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
    const router = testRouter(refreshes);
const wrap = (view: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={view} operator={operator} /></AppRouterContext.Provider>;

    fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
    fireEvent.click(page.getByRole("button", { name: "Review and save" }));
    await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
    expect(save.requests).toHaveLength(1);
    page.rerender(wrap(savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }])));
    expect(page.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(page.getByText(/lost its credentials/).textContent).toContain("A save was already sent");

    await act(async () => { settle(save); });
    expect(page.getByText(/lost its credentials/).textContent).toContain(wording);
    expect(page.getAllByRole("alert").some((alert) => alert.textContent?.includes(error))).toBe(true);
    expect(page.getByRole("status").textContent).not.toBe("Saved.");
  });
}

test("a conflicting save blocks retry until a different revision arrives and resets the draft", async () => {
  const requests = recordFetch(409, { error: { code: "SETTINGS_CONFLICT" }, current: savedResponse });
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (view: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={view} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

  await waitFor(() => expect(page.getByText("Someone else changed these settings")).toBeTruthy());
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  expect(refreshes).toHaveLength(1);
  page.rerender(wrap(savedView([onramp, mexicoOnramp])));
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  expect(requests).toHaveLength(1);
  page.rerender(wrap({ ...savedView([{ ...onramp, selected: false, offered: false }, mexicoOnramp]), revision: 8 }));
  expect(page.queryByText("Someone else changed these settings")).toBeNull();
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  expect(page.getByRole("button", { name: "Review and save" }).hasAttribute("disabled")).toBe(false);
});

test("a save whose refreshed revision never arrives adopts the response and cannot resubmit the stale revision", async () => {
  const save = deferredFetch();
  const view: FundingOfferingView = {
    ...savedView([onramp, mexicoOnramp]),
    source: "deployment",
    revision: 0,
    updatedAt: null,
    updatedBy: null,
    legacy: [{ name: "PEER_OFFRAMP_ENABLED", state: "in-effect" }],
    unknownSaved: [{ providerId: "legacyco", region: "BR", direction: "offramp" }],
  };
  const { page, refreshes } = renderSettings(view);

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ])), 0); });

  expect(page.getByRole("status").textContent).toBe("Saved.");
  expect(page.queryByRole("button", { name: "Discard" })).toBeNull();
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  expect(page.queryByText("Using deployment values — review and save")).toBeNull();
  expect(page.getByText("Last saved", { exact: false })).toBeTruthy();
  expect(page.getByText("is set but ignored", { exact: false })).toBeTruthy();
  expect(page.queryByText("Saved corridors this version no longer offers")).toBeNull();
  expect(refreshes).toHaveLength(1);

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  expect(page.getByRole("status").textContent).toBe("1 unsaved change");
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: false },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ], 9)), 1); });

  expect(save.requests).toHaveLength(2);
  expect(readSaveRequest(save.requests[1]).expectedRevision).toBe(8);
  expect(page.queryByText("Someone else changed these settings")).toBeNull();
  expect(page.getByRole("status").textContent).toBe("Saved.");
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
});

test("a definite failure keeps the adopted revision so the next retry is not a stale one", async () => {
  const save = deferredFetch();
  const view: FundingOfferingView = {
    ...savedView([onramp, mexicoOnramp]),
    source: "deployment",
    revision: 0,
    updatedAt: null,
    updatedBy: null,
  };
  const { page, refreshes } = renderSettings(view);

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ])), 0); });
  expect(page.getByRole("status").textContent).toBe("Saved.");

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json({ error: { code: "SETTINGS_UNAVAILABLE" } }, { status: 503 }), 1); });
  expect(page.getByText("Settings can't be saved right now. Nothing changed. Try again shortly.")).toBeTruthy();
  expect(page.getByRole("button", { name: "Confirm" })).toBeTruthy();

  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: false },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ], 9)), 2); });
  expect(readSaveRequest(save.requests[2]).expectedRevision).toBe(8);
  expect(page.queryByText("Someone else changed these settings")).toBeNull();
  expect(refreshes).toHaveLength(2);
});

test("a refreshed revision supersedes an adopted save and resets the draft", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (next: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={next} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: false },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: false },
  ])), 0); });
  expect(page.getByRole("status").textContent).toBe("Saved.");
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

  page.rerender(wrap({ ...savedView([{ ...onramp, selected: true, offered: true }, mexicoOnramp]), revision: 9 }));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("true");
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  expect(save.requests).toHaveLength(1);
});

test("a credential loss after an adopted save keeps the saved-on corridor on without a pending change", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (next: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={next} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ])), 0); });
  expect(page.getByRole("status").textContent).toBe("Saved.");

  page.rerender(wrap(savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }])));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("true");
  expect(page.getByRole("alert").textContent).toContain("That corridor is saved on and will become available when its credentials are set.");
  expect(page.getByRole("status").textContent).toBe("Saved.");
  expect(page.queryByRole("button", { name: "Discard" })).toBeNull();
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
});
test("a conflict after an adopted save blocks a stale retry", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ])), 0); });
  expect(page.getByRole("status").textContent).toBe("Saved.");

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json({ error: { code: "SETTINGS_CONFLICT" }, current: savedResponse }, { status: 409 }), 1); });

  await waitFor(() => expect(page.getByText("Someone else changed these settings")).toBeTruthy());
  expect(page.getByRole("button", { name: "Review and save" }).hasAttribute("disabled")).toBe(true);
  expect(page.getByRole("status").textContent).not.toBe("Saved.");
  expect(save.requests).toHaveLength(2);
  expect(refreshes).toHaveLength(2);
});

test("a refresh that arrives below the adopted revision cannot roll the console back", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (next: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={next} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ])), 0); });

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: false },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ], 9)), 1); });
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("false");

  page.rerender(wrap({ ...savedView([{ ...onramp, selected: true, offered: true }, { ...mexicoOnramp, selected: true, offered: true }]), revision: 8 }));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
  expect(page.queryByRole("button", { name: "Discard" })).toBeNull();
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(readSaveRequest(save.requests[2]).expectedRevision).toBe(9);
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: false },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: false },
  ], 10)), 2); });
});

test("a corridor the stored response did not echo stays off, new, and out of the next save", async () => {
  const save = deferredFetch();
  const view: FundingOfferingView = { ...savedView([onramp]), source: "deployment", revision: 0, updatedAt: null, updatedBy: null };
  const { page, refreshes } = renderSettings(view);
  const router = testRouter(refreshes);
const wrap = (next: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={next} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
  ], 1)), 0); });
  expect(page.getByRole("status").textContent).toBe("Saved.");

  page.rerender(wrap({
    ...savedView([{ ...onramp, selected: true, offered: true }, { ...mexicoOnramp, selected: true, offered: true }]),
    source: "deployment", revision: 0, updatedAt: null, updatedBy: null,
  }));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getAllByText("New").length).toBe(1);
  expect(page.getByRole("status").textContent).toBe("Saved.");
  expect(page.queryByRole("button", { name: "Discard" })).toBeNull();

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(readSaveRequest(save.requests[1]).value.corridors).toEqual([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: false },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: false },
  ]);
  await act(async () => { save.resolve(Response.json(storedResponse([], 2)), 1); });
});

test("a save that wrote nothing does not claim saved settings", async () => {
  const save = deferredFetch();
  const view: FundingOfferingView = { ...savedView([]), source: "deployment", revision: 0, updatedAt: null, updatedBy: null };
  const { page, refreshes } = renderSettings(view);

  expect(page.getByText("Using deployment values — review and save")).toBeTruthy();
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json({ version: 1, domain: "funding", settings: { value: { corridors: [] }, revision: 0, source: "default", updatedAt: null, updatedBy: null } }), 0); });

  expect(page.queryByText("Saved.")).toBeNull();
  expect(page.getByRole("status").textContent).toBe("Not saved yet");
  expect(page.getByText("Using deployment values — review and save")).toBeTruthy();
  expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
  expect(refreshes).toHaveLength(1);
});

test("a switch changed while a save is in flight survives that save's response", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (next: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={next} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

  page.rerender(wrap(savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }])));
  expect(page.queryByRole("button", { name: "Confirm" })).toBeNull();
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("false");

  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ])), 0); });

  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("status").textContent).toBe("1 unsaved change");
  expect(page.queryByText("Saved.")).toBeNull();

  page.rerender(wrap({ ...savedView([{ ...onramp, connection: "not-connected", missingEnv: ["COINBASE_US_KEY"] }, { ...mexicoOnramp, selected: true, offered: true }]), revision: 8 }));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("status").textContent).toBe("1 unsaved change");

  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(readSaveRequest(save.requests[1]).value.corridors).toContainEqual({ providerId: "coinbase", region: "US", direction: "onramp", offered: false });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: false },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ], 9)), 1); });
});

test("a refreshed revision that lands before an in-flight save's response keeps the pending edit", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (next: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={next} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

  page.rerender(wrap(savedView([onramp, { ...mexicoOnramp, connection: "not-connected", missingEnv: ["COINBASE_MX_KEY"] }])));
  expect(page.queryByRole("button", { name: "Confirm" })).toBeNull();
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("false");

  page.rerender(wrap({ ...savedView([{ ...onramp, selected: true, offered: true }, mexicoOnramp]), revision: 8 }));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("false");
  expect(page.getByRole("status").textContent).toBe("1 unsaved change");

  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ])), 0); });
  expect(page.getByRole("switch", { name: "Add money with Coinbase in United States" }).getAttribute("aria-checked")).toBe("false");
  expect(page.queryByText("Someone else changed these settings")).toBeNull();
});

test("a refreshed revision that lands before a response does not leave the review saving", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (next: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={next} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  expect(page.getByRole("button", { name: "Saving…" })).toBeTruthy();

  page.rerender(wrap({ ...savedView([{ ...onramp, selected: true, offered: true }, { ...mexicoOnramp, selected: true, offered: true }]), revision: 8 }));
  expect(page.getByRole("button", { name: "Saving…" })).toBeTruthy();

  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: true },
    { providerId: "coinbase", region: "MX", direction: "onramp", offered: true },
  ], 8)), 0); });

  expect(page.queryByRole("button", { name: "Saving…" })).toBeNull();
  expect(page.queryByRole("button", { name: "Confirm" })).toBeNull();
  expect(page.getByRole("status").textContent).toBe("No unsaved changes");
});

test("a conflict from an attempt abandoned by a newer revision still surfaces", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (next: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={next} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

  page.rerender(wrap({ ...savedView([onramp, mexicoOnramp]), revision: 9 }));
  await act(async () => { save.resolve(Response.json({ error: { code: "SETTINGS_CONFLICT" } }, { status: 409 }), 0); });

  await waitFor(() => expect(page.getByText("Someone else changed these settings")).toBeTruthy());
  expect(page.getByRole("button", { name: "Review and save" }).hasAttribute("disabled")).toBe(true);
});

test("a corridor absent from the stored echo keeps a visible pending change", async () => {
  const save = deferredFetch();
  const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));
  const router = testRouter(refreshes);
const wrap = (next: FundingOfferingView) => <AppRouterContext.Provider value={router}><FundingSettings view={next} operator={operator} /></AppRouterContext.Provider>;

  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
  page.rerender(wrap(savedView([onramp])));
  fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
  fireEvent.click(page.getByRole("button", { name: "Save" }));
  await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
  await act(async () => { save.resolve(Response.json(storedResponse([
    { providerId: "coinbase", region: "US", direction: "onramp", offered: false },
  ])), 0); });

  page.rerender(wrap(savedView([onramp, mexicoOnramp])));
  expect(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }).getAttribute("aria-checked")).toBe("true");
  expect(page.getByRole("status").textContent).toBe("1 unsaved change");
  expect(page.queryByText("Saved.")).toBeNull();
  expect(page.getByRole("button", { name: "Review and save" }).hasAttribute("disabled")).toBe(false);
});

for (const [status, code, message] of [
  [401, "UNAUTHENTICATED", "Your session ended. Sign in again, then save."],
  [403, "OPERATOR_FORBIDDEN", "This account can't change settings. Sign in with an operator account."],
  [403, "CROSS_ORIGIN", "The save was blocked because it didn't come from this page. Reload, then save again."],
  [400, "INVALID_REQUEST", "These settings couldn't be saved. Reload, then review and save again."],
  [503, "SETTINGS_UNAVAILABLE", "Settings can't be saved right now. Nothing changed. Try again shortly."],
  [409, "OPERATOR_CHANGED", "A different operator is signed in. Reload this page before saving."],
] as const) {
  test(`a ${code} save stays on review with an actionable message`, async () => {
    recordFetch(status, { error: { code } });
    const { page, refreshes } = renderSettings(savedView([onramp, mexicoOnramp]));

    fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
    fireEvent.click(page.getByRole("button", { name: "Save" }));
    await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

    await waitFor(() => expect(page.getByRole("alert").textContent).toContain(message));
    expect(page.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(refreshes).toHaveLength(0);
  });
}

test("save pins the serving deployment and asks for a reload when it is stale", async () => {
  const previous = process.env.NEXT_DEPLOYMENT_ID;
  process.env.NEXT_DEPLOYMENT_ID = "dpl_stale";
  try {
    const requests = recordFetch(404, "not found");
    const { page } = renderSettings(savedView([onramp, mexicoOnramp]));

    fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
    fireEvent.click(page.getByRole("button", { name: "Save" }));
    await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

    expect(new Headers(requests[0]?.init?.headers).get("x-deployment-id")).toBe("dpl_stale");
    await waitFor(() => expect(page.getByRole("alert").textContent).toContain("Reload to update."));
    expect(page.getByRole("button", { name: "Confirm" })).toBeTruthy();
  } finally {
    if (previous === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
    else process.env.NEXT_DEPLOYMENT_ID = previous;
  }
});

for (const [caseName, response] of [
  ["fetch rejection", async () => { throw new TypeError("offline"); }],
  ["unreadable success", async () => new Response("not-json", { status: 200 })],
  ["wrong-domain success", async () => Response.json({ ...savedResponse, domain: "support" })],
  ["invalid funding settings success", async () => Response.json({ ...savedResponse, settings: { ...savedResponse.settings, value: { corridors: [{ providerId: "INVALID", region: "US", direction: "onramp", offered: true }] } } })],
  ["unreadable conflict", async () => new Response("not-json", { status: 409 })],
  ["unrecognized conflict response", async () => Response.json({}, { status: 409 })],
] as const) {
  test(`${caseName} reports an uncertain save and refreshes`, async () => {
    globalThis.fetch = Object.assign(response, { preconnect: nativeFetch.preconnect });
    const { page, refreshes } = renderSettings(savedView([onramp]));

    fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
    fireEvent.click(page.getByRole("button", { name: "Save" }));
    await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

    await waitFor(() => expect(page.getByRole("alert").textContent).toContain("We couldn't confirm whether this saved. Reload to check the latest settings."));
    expect(page.queryByText("Someone else changed these settings")).toBeNull();
    expect(refreshes).toHaveLength(1);
  });
}

for (const source of ["saved", "deployment"] as const) {
  test(`${source} records an untouched disconnected-on corridor as on and reviews its future availability`, async () => {
    const requests = recordFetch(200, echoStored);
    const disconnected = { ...peerOfframp, selected: true, offered: false, confirmedBy: "Live payout on Sep 18" };
    const view = { ...savedView([onramp, disconnected]), source, revision: source === "deployment" ? 0 : 7 };
    const { page } = renderSettings(view);
    expect(page.getByRole("switch", { name: "Cash out with Peer in United States" }).getAttribute("aria-checked")).toBe("true");
    if (source === "saved") fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
    fireEvent.click(page.getByRole("button", { name: source === "saved" ? "Save" : "Review and save" }));

    const review = page.getByRole("region", { name: "On without credentials" });
    expect(review.textContent).toContain("Peer · Cash out · United States");
    expect(review.textContent).toContain("Credentials: PEER_API_KEY not set");
    expect(review.textContent).toContain("Evidence: Live payout on Sep 18");
    expect(review.textContent).toContain("When credentials are set, customers in United States can cash out with Peer via Bank transfer.");
    expect(review.textContent).toContain("saved on and become available when their credentials are set");
    if (source === "deployment") {
      const serving = page.getByRole("region", { name: "On after saving" });
      expect(serving.textContent).toContain("Coinbase");
      expect(serving.textContent).not.toContain("Peer");
    } else {
      expect(page.queryByRole("heading", { name: "Turning on" })).toBeNull();
    }

    await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });
    expect(requests).toHaveLength(1);
    const sent = readSaveRequest(requests[0]?.init);
    expect(sent.operator).toBe(operator);
    expect(sent.value.corridors).toContainEqual({ providerId: "peer", region: "US", direction: "offramp", offered: true });
    expect(sent.value.corridors).toContainEqual({ providerId: "coinbase", region: "US", direction: "onramp", offered: source === "deployment" });
    const parsed = parseFundingSettings(sent.value);
    if (!parsed) throw new Error("expected funding settings to parse");
    const keys = parsed.corridors.map(({ providerId, region, direction }) => `${providerId}:${region}:${direction}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
}

test("the activation review lists only the corridor's credentials, not the provider's other regions", async () => {
  recordFetch(200, echoStored);
  const scoped = corridor({
    providerId: "ripio", providerName: "Ripio", region: "AR", regionName: "Argentina", direction: "onramp",
    credentials: [{ name: "RIPIO_CLIENT_ID_AR", state: "set" }],
  });
  const view: FundingOfferingView = {
    ...savedView([scoped]),
    providers: [{ providerId: "ripio", displayName: "Ripio", credentials: [
      { name: "RIPIO_CLIENT_ID_AR", state: "set" }, { name: "RIPIO_CLIENT_SECRET_BR", state: "unset" },
    ] }],
  };
  const { page } = renderSettings(view);

  fireEvent.click(page.getByRole("switch", { name: "Add money with Ripio in Argentina" }));
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  const review = page.getByRole("region", { name: "Turning on" });
  expect(review.textContent).toContain("Credentials: RIPIO_CLIENT_ID_AR set");
  expect(review.textContent).not.toContain("RIPIO_CLIENT_SECRET_BR");
});

for (const source of ["saved", "deployment"] as const) {
  test(`${source} sends each corridor's rendered switch value across all connection and stored-selection combinations`, async () => {
    const requests = recordFetch(200, echoStored);
    const corridors = [
      onramp,
      mexicoOnramp,
      { ...peerOfframp, selected: true },
      corridor({ providerId: "peer", region: "MX", direction: "offramp", connection: "not-connected", missingEnv: ["PEER_API_KEY"] }),
    ];
    const view = { ...savedView(corridors), source, revision: source === "deployment" ? 0 : 7 };
    const { page } = renderSettings(view);

    fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in United States" }));
    fireEvent.click(page.getByRole("switch", { name: "Add money with Coinbase in Mexico" }));
    const rendered = corridors.map((corridor) => ({
      key: corridor.key,
      checked: page.getByRole("switch", { name: `${corridor.direction === "onramp" ? "Add money" : "Cash out"} with ${corridor.providerName} in ${corridor.regionName}` }).getAttribute("aria-checked") === "true",
    }));
    expect(rendered.map(({ checked }) => checked)).toEqual([false, true, true, false]);
    fireEvent.click(page.getByRole("button", { name: "Review and save" }));
    expect(page.getByRole("region", { name: "On without credentials" }).textContent).toContain("Peer · Cash out · United States");
    expect(page.queryByText(/lost its credentials/)).toBeNull();
    await act(async () => { fireEvent.click(page.getByRole("button", { name: "Confirm" })); });

    expect(requests).toHaveLength(1);
    const sent = readSaveRequest(requests[0]?.init);
    expect(sent.value.corridors.map(({ providerId, region, direction, offered }: { providerId: string; region: string; direction: string; offered: boolean }) => ({
      key: `${providerId}:${region}:${direction}`, checked: offered,
    }))).toEqual(rendered);
  });
}

test("deployment values explain the takeover and review every corridor that stays on", () => {
  const view: FundingOfferingView = {
    ...savedView([onramp, peerOfframp]),
    source: "deployment",
    revision: 0,
    updatedAt: null,
    updatedBy: null,
    legacy: [{ name: "PEER_OFFRAMP_ENABLED", state: "in-effect" }],
  };
  const { page } = renderSettings(view);

  expect(page.getByText("Using deployment values — review and save")).toBeTruthy();
  expect(page.getByText("is in effect", { exact: false })).toBeTruthy();
  fireEvent.click(page.getByRole("button", { name: "Review and save" }));
  expect(page.getByRole("heading", { name: "On after saving" })).toBeTruthy();
  expect(page.getByText("Customers in United States can add money with Coinbase via Bank transfer.")).toBeTruthy();
  expect(page.getByText("Evidence: Live $1 test on Sep 18")).toBeTruthy();
  expect(page.queryByRole("heading", { name: "On without credentials" })).toBeNull();
});

test("saved settings mark new corridors, ignored legacy variables, and corridors this version no longer offers", () => {
  const view: FundingOfferingView = {
    ...savedView([onramp, { ...mexicoOnramp, newSinceSave: true }]),
    legacy: [{ name: "PEER_OFFRAMP_ENABLED", state: "ignored" }],
    unknownSaved: [{ providerId: "legacyco", region: "BR", direction: "offramp" }],
  };
  const { page } = renderSettings(view);

  expect(page.getByText("New")).toBeTruthy();
  expect(page.getByText("is set but ignored", { exact: false })).toBeTruthy();
  expect(page.getByText("Saved corridors this version no longer offers")).toBeTruthy();
  expect(page.getByText("legacyco")).toBeTruthy();
});

test("unset legacy variables are hidden", () => {
  const { page } = renderSettings(savedView([onramp]));
  expect(page.queryByText("PEER_OFFRAMP_ENABLED")).toBeNull();
});

test("the unavailable state says new money in and out is paused and offers a retry", () => {
  const refreshes: number[] = [];
  const router = testRouter(refreshes);
  const page = render(<AppRouterContext.Provider value={router}><FundingSettingsUnavailable /></AppRouterContext.Provider>);

  expect(page.getByRole("alert").textContent).toContain("New money in and out is paused");
  fireEvent.click(page.getByRole("button", { name: "Try again" }));
  expect(refreshes).toHaveLength(1);
});
