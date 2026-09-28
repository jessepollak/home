import "@/client/account/dom-test-harness";

import { afterEach, expect, jest, test } from "bun:test";
import type { SettingsEntry } from "@/shared/operator-settings/contract";
import type { InvestSettings } from "@/shared/operator-settings/invest";
import { INVEST_SETTINGS_DEFAULTS } from "@/shared/operator-settings/invest";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { InvestPane } = await import("./invest-pane");

const initial = { value: INVEST_SETTINGS_DEFAULTS, revision: 0, source: "default" as const, updatedAt: null, updatedBy: null };
const operator = "0x1111111111111111111111111111111111111111" as const;
const stored = { value: { hiddenCategories: ["stock" as const], hiddenAssets: ["cbbtc"] }, revision: 1, source: "stored" as const, updatedAt: "2026-09-25T12:00:00.000Z", updatedBy: "0x1111111111111111111111111111111111111111" };
const result = (settings: SettingsEntry<InvestSettings>["settings"] = stored) => ({ version: 1, domain: "invest", settings });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test("category hiding collapses its assets without erasing their individual choices", () => {
  const view = render(<InvestPane initialEntry={initial} operator={operator} />);
  const stock = view.getByRole("switch", { name: "Stocks category" });
  const nvidia = view.getByRole("switch", { name: "NVIDIA (NVDA)" });
  const save = view.getByRole("button", { name: "Save changes" });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.click(nvidia);
  expect(nvidia.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(stock);
  expect(view.queryByRole("switch", { name: "NVIDIA (NVDA)" })).toBeNull();
  fireEvent.click(stock);
  const restored = view.getByRole("switch", { name: "NVIDIA (NVDA)" });
  expect(restored.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(restored);
  expect(save.hasAttribute("disabled")).toBe(true);
  expect(view.getByText("Trending memes can only be hidden as a category.")).toBeTruthy();
});

test("save sends canonical Invest settings and updates saved attribution", async () => {
  const fetcher = jest.spyOn(globalThis, "fetch").mockResolvedValue(json(result()));
  const view = render(<InvestPane initialEntry={initial} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "Bitcoin (BTC)" }));
  fireEvent.click(view.getByRole("switch", { name: "Stocks category" }));
  const save = view.getByRole("button", { name: "Save changes" });
  expect(save.hasAttribute("disabled")).toBe(false);
  await act(async () => { fireEvent.click(save); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe("/api/admin/settings/invest");
  expect(options?.method).toBe("PUT");
  expect(options?.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(options?.body as string)).toEqual({ version: 1, expectedRevision: 0, value: stored.value, operator });
  expect(view.getByText("Invest settings saved.")).toBeTruthy();
  expect(view.getByText(/Saved .* by 0x1111…1111/)).toBeTruthy();
  expect(save.hasAttribute("disabled")).toBe(true);
});

test("conflict shows latest settings and retry preserves the other operator's change", async () => {
  const fetcher = jest.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(json({ error: { code: "SETTINGS_CONFLICT" }, current: result(stored) }, 409))
    .mockResolvedValueOnce(json(result({ ...stored, revision: 2, value: { hiddenCategories: ["stock", "meme"], hiddenAssets: ["cbbtc"] } })));
  const view = render(<InvestPane initialEntry={initial} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "Memes category" }));
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Save changes" })); });
  expect(view.getByText("Someone else changed these settings. Review the latest values and save again.")).toBeTruthy();
  expect(view.getByRole("switch", { name: "Memes category" }).getAttribute("aria-checked")).toBe("true");
  expect(view.getByRole("switch", { name: "Stocks category" }).getAttribute("aria-checked")).toBe("false");
  expect(view.getByRole("switch", { name: "Bitcoin (BTC)" }).getAttribute("aria-checked")).toBe("false");
  expect(view.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(view.getByRole("switch", { name: "Memes category" }));
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Save changes" })); });
  expect(JSON.parse(fetcher.mock.calls[1]![1]?.body as string)).toEqual({ version: 1, expectedRevision: 1, value: { hiddenCategories: ["stock", "meme"], hiddenAssets: ["cbbtc"] }, operator });
});

test("server error keeps draft and allows retry", async () => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: { code: "SETTINGS_UNAVAILABLE" } }, 503));
  const view = render(<InvestPane initialEntry={initial} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "Degen (DEGEN)" }));
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Save changes" })); });
  expect(view.getByText("Couldn't save. Try again.")).toBeTruthy();
  expect(view.getByRole("switch", { name: "Degen (DEGEN)" }).getAttribute("aria-checked")).toBe("false");
  expect(view.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(false);
});

test("a different operator signs in and the save is refused without losing the draft", async () => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: { code: "OPERATOR_CHANGED" }, current: result(stored) }, 409));
  const view = render(<InvestPane initialEntry={initial} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "Degen (DEGEN)" }));
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Save changes" })); });
  expect(view.getByText("A different operator is signed in. Reload this page before saving.")).toBeTruthy();
  expect(view.getByRole("switch", { name: "Degen (DEGEN)" }).getAttribute("aria-checked")).toBe("false");
  expect(view.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(false);
});

test("pending save is busy and cannot submit again", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation((() => new Promise<Response>((done) => { resolve = done; })) as unknown as typeof fetch);
  const view = render(<InvestPane initialEntry={initial} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "Stocks category" }));
  fireEvent.click(view.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(view.getByRole("button", { name: "Save changes" }).getAttribute("aria-busy")).toBe("true");
  fireEvent.click(view.getByRole("button", { name: "Save changes" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => resolve(json(result({ ...stored, value: { hiddenCategories: ["stock"], hiddenAssets: [] } }))));
});

test("save pins the serving deployment and asks for a reload when it is stale", async () => {
  const previous = process.env.NEXT_DEPLOYMENT_ID;
  process.env.NEXT_DEPLOYMENT_ID = "dpl_stale";
  try {
    const fetcher = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
    const view = render(<InvestPane initialEntry={initial} operator={operator} />);
    fireEvent.click(view.getByRole("switch", { name: "Bitcoin (BTC)" }));
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Save changes" })); });
    expect(fetcher.mock.calls[0]![1]?.headers).toEqual({ "Content-Type": "application/json", "x-deployment-id": "dpl_stale" });
    expect(view.getByText("Reload to update.")).toBeTruthy();
  } finally {
    if (previous === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
    else process.env.NEXT_DEPLOYMENT_ID = previous;
  }
});

test("an operator change discards the previous operator's draft", () => {
  const nextOperator = "0x4444444444444444444444444444444444444444" as const;
  const view = render(<InvestPane initialEntry={initial} operator={operator} />);
  fireEvent.click(view.getByRole("switch", { name: "Bitcoin (BTC)" }));
  expect(view.getByRole("switch", { name: "Bitcoin (BTC)" }).getAttribute("aria-checked")).toBe("false");
  view.rerender(<InvestPane initialEntry={initial} operator={nextOperator} />);
  expect(view.getByRole("switch", { name: "Bitcoin (BTC)" }).getAttribute("aria-checked")).toBe("true");
  expect(view.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true);
});
