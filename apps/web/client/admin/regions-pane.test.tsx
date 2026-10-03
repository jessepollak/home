import "@/client/account/dom-test-harness";

import { afterEach, expect, jest, test } from "bun:test";
import { countryRegionIds } from "@/config/regions";
import { REGION_SETTINGS_DEFAULTS } from "@/shared/operator-settings/regions";
import { isRecord } from "@/shared/guards";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { regionChanges, RegionsPane } = await import("./regions-pane");

const initialEntry = { value: REGION_SETTINGS_DEFAULTS, revision: 0, source: "default" as const, updatedAt: null, updatedBy: null };
const operator = "0x1111111111111111111111111111111111111111" as const;
const stored = { value: { offered: countryRegionIds.filter((code) => code !== "US"), defaultRegion: "GLOBAL" as const }, revision: 1, source: "stored" as const, updatedAt: "2026-09-25T12:00:00.000Z", updatedBy: "0x1111111111111111111111111111111111111111" };
const settingsResponse = (settings = stored) => ({ version: 1, domain: "regions", settings });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const review = (view: ReturnType<typeof render>) => {
  fireEvent.click(view.getByRole("button", { name: "Review changes" }));
  return within(document.body).findByRole("dialog", { name: "Review region changes" });
};

afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test("membership diff and turning off default resets the draft to Global", () => {
  expect(regionChanges(initialEntry.value, { offered: [...countryRegionIds].reverse(), defaultRegion: "US" })).toEqual({ turnedOn: [], turnedOff: [], defaultChanged: false });
  const view = render(<RegionsPane initialEntry={initialEntry} operator={operator} />);
  const button = view.getByRole("button", { name: "Review changes" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(view.getByRole("switch", { name: "United States" }));
  expect((view.getByRole("combobox", { name: "Default region" }) as HTMLSelectElement).value).toBe("GLOBAL");
  expect(view.getByText(/Default reset to Global/)).toBeTruthy();
  expect(view.getByText(`Offered countries (${countryRegionIds.length - 1})`)).toBeTruthy();
  fireEvent.click(view.getByRole("switch", { name: "United States" }));
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.change(view.getByRole("combobox", { name: "Default region" }), { target: { value: "US" } });
  expect(button.hasAttribute("disabled")).toBe(true);
});

test("review explains impact and saves only on confirmation with expected revision", async () => {
  const fetcher = jest.spyOn(globalThis, "fetch").mockResolvedValue(response(settingsResponse()));
  const view = render(<RegionsPane initialEntry={initialEntry} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "United States" }));
  const dialog = await review(view);
  expect(dialog.textContent).toContain("Existing balances and orders keep working");
  expect(dialog.textContent).toContain("United States");
  expect(dialog.textContent).toContain("Global");
  expect(fetcher).toHaveBeenCalledTimes(0);
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirm changes" })); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [path, init] = fetcher.mock.calls[0]!;
  expect(path).toBe("/api/admin/settings/regions");
  expect(init?.method).toBe("PUT");
  expect(JSON.parse(init?.body as string)).toEqual({ version: 1, expectedRevision: 0, value: stored.value, operator });
  expect(init?.headers).toEqual({ "Content-Type": "application/json" });
  expect(view.getByText("Region settings saved.")).toBeTruthy();
  expect(view.getByText(/Saved 2026-09-25 12:00 UTC by 0x1111…1111/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Review changes" }).hasAttribute("disabled")).toBe(true);
});

test("save pins the serving deployment and asks for a reload when it is stale", async () => {
  const previous = process.env.NEXT_DEPLOYMENT_ID;
  process.env.NEXT_DEPLOYMENT_ID = "dpl_stale";
  try {
    const fetcher = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
    const view = render(<RegionsPane initialEntry={initialEntry} operator={operator} />);
    fireEvent.click(view.getByRole("switch", { name: "United States" }));
    const dialog = await review(view);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirm changes" })); });
    expect(fetcher.mock.calls[0]![1]?.headers).toEqual({ "Content-Type": "application/json", "x-deployment-id": "dpl_stale" });
    expect(within(dialog).getByText("Reload to update.")).toBeTruthy();
  } finally {
    if (previous === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
    else process.env.NEXT_DEPLOYMENT_ID = previous;
  }
});

test("an operator change discards the previous operator's draft", () => {
  const nextOperator = "0x4444444444444444444444444444444444444444" as const;
  const view = render(<RegionsPane initialEntry={initialEntry} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "United States" }));
  expect(view.getByRole("switch", { name: "United States" }).getAttribute("aria-checked")).toBe("false");
  view.rerender(<RegionsPane initialEntry={initialEntry} operator={nextOperator} />);
  expect(view.getByRole("switch", { name: "United States" }).getAttribute("aria-checked")).toBe("true");
  expect(view.getByRole("button", { name: "Review changes" }).hasAttribute("disabled")).toBe(true);
});

test("409 updates baseline and keeps draft for new review using latest revision", async () => {
  const fetcher = jest.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(response({ error: { code: "SETTINGS_CONFLICT" }, current: settingsResponse(stored) }, 409))
    .mockResolvedValueOnce(response(settingsResponse({ ...stored, revision: 2, value: { offered: [], defaultRegion: "GLOBAL" } })));
  const view = render(<RegionsPane initialEntry={initialEntry} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "United States" }));
  fireEvent.click(view.getByRole("switch", { name: "United Kingdom" }));
  const dialog = await review(view);
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirm changes" })); });
  expect(view.getByText(/Someone else changed these settings/)).toBeTruthy();
  expect(view.getByRole("switch", { name: "United Kingdom" }).getAttribute("aria-checked")).toBe("false");
  const next = await review(view);
  expect(next.textContent).toContain("United Kingdom");
  expect(next.textContent).not.toContain("United States");
  await act(async () => { fireEvent.click(within(next).getByRole("button", { name: "Confirm changes" })); });
  const body = fetcher.mock.calls[1]![1]?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON request body");
  const request: unknown = JSON.parse(body);
  if (!isRecord(request)) throw new Error("Expected a settings request object");
  expect(request.expectedRevision).toBe(1);
  expect(view.getByText("Region settings saved.")).toBeTruthy();
});

test.each([
  [400, "INVALID_REQUEST", /Check the selected regions/],
  [403, "OPERATOR_FORBIDDEN", /Sign in as an operator/],
  [503, "SETTINGS_UNAVAILABLE", /Try again shortly/],
  [409, "OPERATOR_CHANGED", /A different operator is signed in/],
] as const)("%s save error allows another attempt", async (status, code, message) => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue(response({ error: { code } }, status));
  const view = render(<RegionsPane initialEntry={initialEntry} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "United States" }));
  const dialog = await review(view);
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirm changes" })); });
  expect(within(dialog).getByText(message)).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Confirm changes" }).hasAttribute("disabled")).toBe(false);
});

test("pending confirmation cannot be submitted again", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation((() => new Promise<Response>((done) => { resolve = done; })) as unknown as typeof fetch);
  const view = render(<RegionsPane initialEntry={initialEntry} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "United States" }));
  const dialog = await review(view);
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm changes" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(within(dialog).getByRole("button", { name: "Confirm changes" }).getAttribute("aria-busy")).toBe("true");
  await act(async () => resolve(response(settingsResponse())));
});
