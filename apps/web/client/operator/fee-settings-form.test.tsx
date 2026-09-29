import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { FeeSettingsState } from "./fee-settings-form";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { FeeSettingsForm } = await import("./fee-settings-form");

const stored: FeeSettingsState = {
  value: { trade: { bps: 50, recipient: "0x1111111111111111111111111111111111111111" } },
  revision: 3,
  source: "stored",
  updatedAt: "2026-09-24T12:00:00.000Z",
  updatedBy: "0x2222222222222222222222222222222222222222",
};
const defaults: FeeSettingsState = { value: { trade: { bps: 0, recipient: null } }, revision: 0, source: "default", updatedAt: null, updatedBy: null };
const nonAllowlisted = "0x9999999999999999999999999999999999999999";
const operator = "0x2222222222222222222222222222222222222222" as const;
const nativeFetch = globalThis.fetch;

type Call = { url: string; init: RequestInit };

function respond(status: number, body: unknown) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

function savedResponse(settings: FeeSettingsState) {
  return { version: 1, domain: "fees", settings };
}

afterEach(() => {
  cleanup();
  globalThis.fetch = nativeFetch;
});

function setup(initial = stored) {
  const view = render(<FeeSettingsForm initial={initial} operator={operator} />);
  const bps = view.getByLabelText("Swap fee") as HTMLInputElement;
  const destination = view.getByLabelText("Revenue destination") as HTMLInputElement;
  const save = () => fireEvent.click(view.getByRole("button", { name: "Save" }));
  return { view, bps, destination, save };
}

describe("FeeSettingsForm", () => {
  test("rejects a fee above the 300 bps cap without saving", async () => {
    const calls = respond(200, savedResponse(stored));
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "301" } });
    save();
    expect(await view.findByText("Enter a whole number from 0 to 300.")).toBeTruthy();
    expect(bps.getAttribute("aria-invalid")).toBe("true");
    expect(calls).toHaveLength(0);
  });

  test("shows the equivalent percent for the entered fee", () => {
    const { view, bps } = setup();
    fireEvent.input(bps, { target: { value: "75" } });
    expect(view.getByText("75 bps = 0.75% of each swap.")).toBeTruthy();
  });

  test("requires a destination before charging a fee", async () => {
    const calls = respond(200, savedResponse(stored));
    const { view, bps, save } = setup(defaults);
    fireEvent.input(bps, { target: { value: "25" } });
    save();
    expect(await view.findByText("Add a revenue destination to charge a fee.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  test("rejects an invalid or zero destination", async () => {
    const { view, destination, save } = setup();
    fireEvent.input(destination, { target: { value: "0x1234" } });
    save();
    expect(await view.findByText("Enter a valid Base address.")).toBeTruthy();
    fireEvent.input(destination, { target: { value: `0x${"0".repeat(40)}` } });
    expect(view.getByText("Enter a valid Base address.")).toBeTruthy();
  });

  test("confirms a new destination with its checksummed form before saving it", async () => {
    const lowercase = "0x52908400098527886e0f7030069857d2e4169ee7";
    const next = { ...stored, revision: 4, value: { trade: { bps: 50, recipient: lowercase } } } satisfies FeeSettingsState;
    const calls = respond(200, savedResponse(next));
    const { view, destination, save } = setup();
    fireEvent.input(destination, { target: { value: lowercase } });
    save();
    const heading = await view.findByRole("heading", { name: "Confirm revenue destination" });
    expect(document.activeElement).toBe(heading);
    expect(view.getByText("0x52908400098527886E0F7030069857D2E4169EE7")).toBeTruthy();
    expect(calls).toHaveLength(0);

    fireEvent.click(view.getByRole("button", { name: "Confirm and save" }));
    expect(await view.findByText("Saved. New quotes use these settings.")).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/admin/settings/fees");
    expect(calls[0].init.method).toBe("PUT");
    expect(new Headers(calls[0].init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ version: 1, expectedRevision: 3, value: { trade: { bps: 50, recipient: lowercase } }, operator });
    expect(destination.value).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(view.queryByRole("heading", { name: "Confirm revenue destination" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Save" })));
  });

  test("returns focus to Save when the confirmation is dismissed", async () => {
    const calls = respond(200, savedResponse(stored));
    const { view, destination, save } = setup(defaults);
    fireEvent.input(destination, { target: { value: nonAllowlisted } });
    save();
    await view.findByRole("heading", { name: "Confirm revenue destination" });
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Save" })));
    expect(destination.value).toBe(nonAllowlisted);
    expect(calls).toHaveLength(0);
  });

  test("saves a fee-only change without asking to confirm the destination", async () => {
    const calls = respond(200, savedResponse({ ...stored, revision: 4, value: { trade: { bps: 120, recipient: stored.value.trade.recipient } } }));
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "120" } });
    save();
    expect(await view.findByText("Saved. New quotes use these settings.")).toBeTruthy();
    expect(view.queryByRole("heading", { name: "Confirm revenue destination" })).toBeNull();
    expect(JSON.parse(String(calls[0].init.body)).value).toEqual({ trade: { bps: 120, recipient: stored.value.trade.recipient } });
  });

  test("loads the latest settings after a revision conflict", async () => {
    const current = { ...stored, revision: 5, value: { trade: { bps: 200, recipient: stored.value.trade.recipient } } } satisfies FeeSettingsState;
    const calls = respond(409, { error: { code: "SETTINGS_CONFLICT" }, current: savedResponse(current) });
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "80" } });
    save();
    expect(await view.findByText("Settings changed")).toBeTruthy();
    expect(bps.value).toBe("200");

    fireEvent.input(bps, { target: { value: "80" } });
    const retry = respond(200, savedResponse({ ...current, revision: 6 }));
    save();
    await view.findByText("Saved. New quotes use these settings.");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(retry[0].init.body)).expectedRevision).toBe(5);
  });

  test("discards a draft when the signed-in operator changes at the same revision", async () => {
    const newer = { ...stored, value: { trade: { bps: 200, recipient: stored.value.trade.recipient } } } satisfies FeeSettingsState;
    respond(409, { error: { code: "OPERATOR_CHANGED" }, current: savedResponse(newer) });
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "80" } });
    save();
    expect((await view.findByText("A different operator is signed in. Reload this page before saving.")).textContent).toBeTruthy();
    expect(bps.value).toBe("200");
    expect(view.queryByText("Saved. New quotes use these settings.")).toBeNull();
  });

  test("keyed form drops an operator's draft at the same settings revision", async () => {
    const nextOperator = "0x3333333333333333333333333333333333333333" as const;
    const calls = respond(200, savedResponse({ ...stored, revision: 4 }));
    function KeyedForm({ activeOperator }: { activeOperator: `0x${string}` }) {
      return <FeeSettingsForm key={activeOperator} initial={stored} operator={activeOperator} />;
    }
    const view = render(<KeyedForm activeOperator={operator} />);
    fireEvent.input(view.getByLabelText("Swap fee"), { target: { value: "120" } });
    expect((view.getByLabelText("Swap fee") as HTMLInputElement).value).toBe("120");
    view.rerender(<KeyedForm activeOperator={nextOperator} />);
    expect((view.getByLabelText("Swap fee") as HTMLInputElement).value).toBe("50");
    fireEvent.input(view.getByLabelText("Swap fee"), { target: { value: "80" } });
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    await view.findByText("Saved. New quotes use these settings.");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ version: 1, expectedRevision: 3, value: { trade: { bps: 80, recipient: stored.value.trade.recipient } }, operator: nextOperator });
  });

  test("adopts newer server settings when the page refreshes", () => {
    const { view, bps, destination } = setup();
    const next = { ...stored, revision: 4, updatedAt: "2026-09-25T12:00:00.000Z", value: { trade: { bps: 100, recipient: "0x3333333333333333333333333333333333333333" as const } } } satisfies FeeSettingsState;
    view.rerender(<FeeSettingsForm initial={next} operator={operator} />);
    expect(bps.value).toBe("100");
    expect(destination.value).toBe("0x3333333333333333333333333333333333333333");
  });

  test("keeps in-progress edits when the page refreshes with unchanged settings", () => {
    const { view, bps } = setup();
    fireEvent.input(bps, { target: { value: "120" } });
    view.rerender(<FeeSettingsForm initial={{ ...stored }} operator={operator} />);
    expect(bps.value).toBe("120");
  });

  test("drops an open destination confirmation when newer settings arrive", async () => {
    const { view, bps, destination } = setup();
    fireEvent.input(destination, { target: { value: nonAllowlisted } });
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    expect(view.getByRole("heading", { name: "Confirm revenue destination" })).toBeTruthy();
    const next = { ...stored, revision: 4, updatedAt: "2026-09-25T12:00:00.000Z", value: { trade: { bps: 100, recipient: stored.value.trade.recipient } } } satisfies FeeSettingsState;
    view.rerender(<FeeSettingsForm initial={next} operator={operator} />);
    expect(view.queryByRole("heading", { name: "Confirm revenue destination" })).toBeNull();
    expect(bps.value).toBe("100");
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Save" })));
  });

  test("ignores an older server revision after adopting newer settings", async () => {
    const current = { ...stored, revision: 5, value: { trade: { bps: 200, recipient: stored.value.trade.recipient } } } satisfies FeeSettingsState;
    respond(409, { error: { code: "SETTINGS_CONFLICT" }, current: savedResponse(current) });
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "80" } });
    save();
    expect(await view.findByText("Settings changed")).toBeTruthy();
    expect(bps.value).toBe("200");
    view.rerender(<FeeSettingsForm initial={{ ...stored, revision: 4, value: { trade: { bps: 40, recipient: stored.value.trade.recipient } } }} operator={operator} />);
    expect(bps.value).toBe("200");
  });

  test("ignores a save response older than the settings already shown", async () => {
    let resolveResponse!: (response: Response) => void;
    globalThis.fetch = (async () => await new Promise<Response>((resolve) => { resolveResponse = resolve; })) as unknown as typeof fetch;
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "120" } });
    save();
    const newer = { ...stored, revision: 5, updatedAt: "2026-09-25T13:00:00.000Z", value: { trade: { bps: 200, recipient: stored.value.trade.recipient } } } satisfies FeeSettingsState;
    view.rerender(<FeeSettingsForm initial={newer} operator={operator} />);
    resolveResponse(new Response(JSON.stringify(savedResponse({ ...stored, revision: 4, value: { trade: { bps: 120, recipient: stored.value.trade.recipient } } })), { status: 200, headers: { "content-type": "application/json" } }));
    expect(await view.findByText("Settings changed")).toBeTruthy();
    expect(bps.value).toBe("200");
  });

  test("keeps edits made after a save when the page refreshes to the saved settings", async () => {
    const saved = { ...stored, revision: 4, value: { trade: { bps: 120, recipient: stored.value.trade.recipient } } } satisfies FeeSettingsState;
    respond(200, savedResponse(saved));
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "120" } });
    save();
    await view.findByText("Saved. New quotes use these settings.");
    fireEvent.input(bps, { target: { value: "150" } });
    view.rerender(<FeeSettingsForm initial={saved} operator={operator} />);
    expect(bps.value).toBe("150");
  });

  test("clears a saved status when external settings replace the shown values", async () => {
    const saved = { ...stored, revision: 4, value: { trade: { bps: 120, recipient: stored.value.trade.recipient } } } satisfies FeeSettingsState;
    respond(200, savedResponse(saved));
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "120" } });
    save();
    await view.findByText("Saved. New quotes use these settings.");
    const external = { ...stored, revision: 6, updatedAt: "2026-09-26T12:00:00.000Z", value: { trade: { bps: 200, recipient: stored.value.trade.recipient } } } satisfies FeeSettingsState;
    view.rerender(<FeeSettingsForm initial={external} operator={operator} />);
    expect(bps.value).toBe("200");
    expect(view.queryByText("Saved. New quotes use these settings.")).toBeNull();
  });

  test("announces an actionable error when settings are unavailable", async () => {
    respond(503, { error: { code: "SETTINGS_UNAVAILABLE" } });
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "60" } });
    save();
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toContain("Settings are unavailable right now. Try again in a moment.");
    expect(bps.value).toBe("60");
  });

  test("does not adopt a save response for another settings domain", async () => {
    respond(200, { version: 1, domain: "brand", settings: { value: { trade: { bps: 60, recipient: stored.value.trade.recipient } }, revision: 4, source: "stored", updatedAt: null, updatedBy: null } });
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "60" } });
    save();
    expect((await view.findByRole("alert")).textContent).toContain("The save couldn’t be confirmed. Reload this page to check the current values.");
    expect(bps.value).toBe("60");
    expect(view.queryByText("Saved. New quotes use these settings.")).toBeNull();
  });

  test("ignores another domain's current settings in a conflict response", async () => {
    respond(409, { error: { code: "SETTINGS_CONFLICT" }, current: { version: 1, domain: "brand", settings: { value: { trade: { bps: 200, recipient: stored.value.trade.recipient } }, revision: 4, source: "stored", updatedAt: null, updatedBy: null } } });
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "80" } });
    save();
    expect((await view.findByRole("alert")).textContent).toContain("Settings changed");
    expect(bps.value).toBe("80");
  });

  test("explains a forbidden save", async () => {
    respond(403, { error: { code: "OPERATOR_FORBIDDEN" } });
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "60" } });
    save();
    expect((await view.findByRole("alert")).textContent).toContain("This account can’t change settings.");
  });

  test("keeps the draft and reports a reach failure when the save request rejects", async () => {
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "60" } });
    save();
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toContain("Couldn’t reach Home. Check your connection and try again.");
    expect(bps.value).toBe("60");
    expect(view.queryByText("Saved. New quotes use these settings.")).toBeNull();
  });

  test("does not confirm a save whose response cannot be parsed", async () => {
    respond(200, { unexpected: true });
    const { view, bps, save } = setup();
    fireEvent.input(bps, { target: { value: "60" } });
    save();
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toContain("The save couldn’t be confirmed. Reload this page to check the current values.");
    expect(bps.value).toBe("60");
    expect(view.queryByText("Saved. New quotes use these settings.")).toBeNull();
  });

  test("pins the serving deployment and asks for a reload when it is stale", async () => {
    const previous = process.env.NEXT_DEPLOYMENT_ID;
    process.env.NEXT_DEPLOYMENT_ID = "dpl_stale";
    try {
      const calls: Call[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response("not found", { status: 404 });
      }) as typeof fetch;
      const { view, bps, save } = setup();
      fireEvent.input(bps, { target: { value: "60" } });
      save();
      expect((await view.findByRole("alert")).textContent).toContain("Reload to update.");
      expect(new Headers(calls[0].init.headers).get("x-deployment-id")).toBe("dpl_stale");
      expect(bps.value).toBe("60");
    } finally {
      if (previous === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
      else process.env.NEXT_DEPLOYMENT_ID = previous;
    }
  });
});
