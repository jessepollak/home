import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { getHomeQueryClient } from "@/client/query/query-client";
import { cardsBody } from "@/tests/browser/fixtures/bodies";

const SECRET = `ek_test_${"s".repeat(24)}`;
const NONCE = `nonce_${"n".repeat(16)}`;

type Element = { mount: ReturnType<typeof jest.fn>; destroy: ReturnType<typeof jest.fn> };
let created: { type: string; element: Element }[] = [];
let createNonce = jest.fn(async () => ({ nonce: NONCE }));
let loadStripe = jest.fn(async (_key: string): Promise<unknown> => fakeStripe());

function fakeStripe() {
  return {
    createEphemeralKeyNonce: (...args: unknown[]) => createNonce(...(args as [])),
    elements: () => ({
      create: (type: string) => {
        const element = { mount: jest.fn(), destroy: jest.fn() };
        created.push({ type, element });
        return element;
      },
    }),
  };
}

await mock.module("@stripe/stripe-js/pure", () => ({ loadStripe: (key: string) => loadStripe(key) }));

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { CardDetailsReveal } = await import("./card-reveal");
const { CardScreen } = await import("./card-experience");
const { useCards } = await import("./use-cards");

const realFetch = globalThis.fetch;
const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
let reports: string[] = [];
let consoleOutput: unknown[][] = [];

beforeEach(() => {
  created = [];
  createNonce = jest.fn(async () => ({ nonce: NONCE }));
  loadStripe = jest.fn(async () => fakeStripe());
  reports = [];
  consoleOutput = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    reports.push(`${String(input)} ${String(init?.body ?? "")}`);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  for (const method of consoleMethods) jest.spyOn(console, method).mockImplementation((...args: unknown[]) => { consoleOutput.push(args); });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  jest.restoreAllMocks();
  getHomeQueryClient().clear();
});

function renderReveal(onKey: (body: unknown) => unknown) {
  const fetchAccountResource = async (path: string, options?: { body?: unknown }) =>
    path.endsWith("/ephemeral-key") ? onKey(options?.body) : cardsBody("active");
  function Harness() {
    const { commands } = useCards({ ownerKey: "owner-1", fetchAccountResource });
    return <CardDetailsReveal cardId="ic_fixture4821" publishableKey="pk_test_fixture" revealKey={commands.revealKey} />;
  }
  return render(<Harness />);
}

const keyResponse = { version: 1 as const, cardId: "ic_fixture4821", ephemeralKeySecret: SECRET };

async function expectFailure(view: ReturnType<typeof render>) {
  expect(await view.findByText("Couldn't show card details.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
  await waitFor(() => expect(reports.some((report) => report.includes("/api/client-errors"))).toBe(true));
  const surfaces = [view.container.innerHTML, ...reports, JSON.stringify(consoleOutput.map((args) => args.map(String)))];
  for (const surface of surfaces) {
    expect(surface).not.toContain(SECRET);
    expect(surface).not.toContain(NONCE);
  }
  expect(created).toEqual([]);
}

describe("CardDetailsReveal failures", () => {
  test("Stripe.js failing to load offers a retry that can recover", async () => {
    loadStripe.mockImplementationOnce(async () => { throw new Error("Failed to load Stripe.js"); });
    const view = renderReveal(() => keyResponse);
    await expectFailure(view);
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(created.map(({ type }) => type)).toEqual([
      "issuingCardNumberDisplay", "issuingCardExpiryDisplay", "issuingCardCvcDisplay",
    ]));
    expect(loadStripe).toHaveBeenCalledTimes(2);
    expect(view.queryByText("Couldn't show card details.")).toBeNull();
    expect(view.container.innerHTML).not.toContain(SECRET);
  });

  test("Stripe.js resolving without a client shows the failure", async () => {
    loadStripe.mockImplementationOnce(async () => null);
    const view = renderReveal(() => keyResponse);
    await expectFailure(view);
  });

  test("a failed ephemeral key request shows the failure without the key", async () => {
    const keyBodies: unknown[] = [];
    const view = renderReveal((body) => { keyBodies.push(body); return { ...keyResponse, cardId: "ic_other0000" }; });
    await expectFailure(view);
    expect(keyBodies).toEqual([{ nonce: NONCE }]);
  });

  test("an ephemeral key request that errors shows the failure", async () => {
    const view = renderReveal(() => { throw new Error("ephemeral key unavailable"); });
    await expectFailure(view);
  });

  test("a rejected ephemeral key nonce shows the failure without requesting a key", async () => {
    createNonce = jest.fn(async () => { throw new Error(`nonce failed ${NONCE}`); });
    const keyBodies: unknown[] = [];
    const view = renderReveal((body) => { keyBodies.push(body); return keyResponse; });
    await expectFailure(view);
    expect(keyBodies).toEqual([]);
  });
});

describe("CardDetailsReveal lifecycle", () => {
  test("closing card details destroys every mounted Stripe element", async () => {
    const view = render(<CardScreen cards={{ status: "ready", response: cardsBody("active") }}
      commands={{ enroll: jest.fn(), issue: jest.fn(), setFrozen: jest.fn() }} onRetry={() => {}} onOpenVerification={() => {}}
      reveal={{ publishableKey: "pk_test_fixture", revealKey: async () => keyResponse }} />);
    fireEvent.click(view.getByRole("button", { name: "Card details" }));
    await waitFor(() => expect(created).toHaveLength(3));
    for (const { element } of created) expect(element.mount).toHaveBeenCalledTimes(1);
    fireEvent.click(await view.findByRole("button", { name: "Close card details" }));
    await waitFor(() => { for (const { element } of created) expect(element.destroy).toHaveBeenCalledTimes(1); });
  });
});
