import "@/client/account/dom-test-harness";

import { afterEach, expect, jest, mock, test } from "bun:test";
import { environmentManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { getHomeQueryClient } from "@/client/query/query-client";
import { IdentityVerification, type IdentityWallet } from "./identity-verification";

afterEach(() => { cleanup(); getHomeQueryClient().clear(); mock.restore(); });

const inProgress = { state: "in-progress", category: "verification-required", action: "continue", verifiedAt: null, retryReason: null, supportUrl: null, consentRequired: false };

function wallet(requests: string[], link: () => Promise<unknown>): IdentityWallet {
  return {
    status: "verified", verification: "server",
    session: { user: { subject: "hosted-recovery" }, accountProvider: "cdp-embedded", smartAccount: null },
    fetchAccountResource: async (path) => {
      requests.push(path);
      if (path.endsWith("/session")) return { version: 1, token: "fixture-token", status: inProgress };
      if (path.endsWith("/link")) return link();
      return { version: 1, status: inProgress };
    },
  };
}

function fakeTab() {
  return { opener: {} as unknown, location: { replace: mock((_url: string) => {}) }, close: mock(() => {}) };
}

async function withOpen(open: (url?: string, target?: string) => unknown, run: () => Promise<void>) {
  const originalOpen = window.open;
  window.open = open as unknown as typeof window.open;
  try { await run(); } finally { window.open = originalOpen; }
}

async function reachRecovery(identityWallet: IdentityWallet) {
  const view = render(<ul><IdentityVerification wallet={identityWallet} loadSdk={async () => { throw new Error("SDK unavailable"); }} /></ul>);
  await waitFor(() => expect(view.getByRole("button", { name: "Continue" })).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(view.getByRole("button", { name: "Continue in a new tab" })).toBeTruthy());
  return view;
}

test("embedded failure opens the recovery tab before the link request, then navigates it", async () => {
  const requests: string[] = [];
  const tab = fakeTab();
  let linkRequestsAtOpen = -1;
  const opened = mock((_url?: string, _target?: string) => {
    linkRequestsAtOpen = requests.filter((path) => path.endsWith("/link")).length;
    return tab;
  });
  await withOpen(opened, async () => {
    const view = await reachRecovery(wallet(requests, async () => ({ version: 1, url: "https://example.com/hosted" })));
    fireEvent.click(view.getByRole("button", { name: "Continue in a new tab" }));
    expect(opened).toHaveBeenCalledWith("about:blank", "_blank");
    expect(linkRequestsAtOpen).toBe(0);
    expect(tab.opener).toBeNull();
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith("https://example.com/hosted"));
    expect(tab.close).not.toHaveBeenCalled();
  });
});

test("a blocked recovery tab shows an error without requesting a link", async () => {
  const requests: string[] = [];
  await withOpen(() => null, async () => {
    const view = await reachRecovery(wallet(requests, async () => ({ version: 1, url: "https://example.com/hosted" })));
    fireEvent.click(view.getByRole("button", { name: "Continue in a new tab" }));
    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    expect(requests.some((path) => path.endsWith("/link"))).toBe(false);
  });
});

test("a failed link request closes the recovery tab and shows an error", async () => {
  const tab = fakeTab();
  await withOpen(() => tab, async () => {
    const view = await reachRecovery(wallet([], async () => { throw new Error("unavailable"); }));
    fireEvent.click(view.getByRole("button", { name: "Continue in a new tab" }));
    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });
});

test.each([
  ["a state conflict", { status: 409, code: "IDENTITY_STATE_CONFLICT" }, "Checking your details"],
  ["a consent requirement", { status: 400, code: "CONSENT_REQUIRED" }, "Checking your details"],
  ["a configuration gap", { status: 503, code: "IDENTITY_CONFIGURATION_UNAVAILABLE" }, "Identity verification isn't available right now"],
])("%s from the link request closes recovery and shows the current state", async (_name, failure, title) => {
  const requests: string[] = [];
  const tab = fakeTab();
  let linkFailed = false;
  const identityWallet = wallet(requests, async () => { linkFailed = true; throw Object.assign(new Error("link unavailable"), failure); });
  const readStatus = identityWallet.fetchAccountResource;
  identityWallet.fetchAccountResource = async (path, init) => linkFailed && path === "/api/identity/verification"
    ? (requests.push(path), { version: 1, status: { ...inProgress, state: "pending", category: "verification-pending", action: "wait" } })
    : readStatus(path, init);
  await withOpen(() => tab, async () => {
    const view = await reachRecovery(identityWallet);
    fireEvent.click(view.getByRole("button", { name: "Continue in a new tab" }));
    await waitFor(() => expect(view.getByText(title)).toBeTruthy());
    expect(view.queryByRole("button", { name: "Continue in a new tab" })).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });
});

test("a launched recovery tab keeps rechecking status until the provider decision arrives", async () => {
  const requests: string[] = [];
  const tab = fakeTab();
  const statusReads = () => requests.filter((path) => path === "/api/identity/verification").length;
  const flush = () => act(async () => { for (let turn = 0; turn < 50; turn += 1) await Promise.resolve(); });
  await withOpen(() => tab, async () => {
    const view = await reachRecovery(wallet(requests, async () => ({ version: 1, url: "https://example.com/hosted" })));
    const wasServer = environmentManager.isServer();
    environmentManager.setIsServer(() => false);
    jest.useFakeTimers();
    try {
      fireEvent.click(view.getByRole("button", { name: "Continue in a new tab" }));
      await flush();
      expect(tab.location.replace).toHaveBeenCalled();
      fireEvent.click(view.getByRole("button", { name: "Close" }));
      await flush();
      const before = statusReads();
      for (let tick = 0; tick < 3; tick += 1) {
        act(() => { jest.advanceTimersByTime(10_000); });
        await flush();
      }
      expect(statusReads()).toBeGreaterThanOrEqual(before + 3);
    } finally {
      jest.useRealTimers();
      environmentManager.setIsServer(() => wasServer);
    }
  });
});

test("returning from a long hosted session re-arms status polling", async () => {
  const requests: string[] = [];
  const tab = fakeTab();
  const statusReads = () => requests.filter((path) => path === "/api/identity/verification").length;
  const flush = () => act(async () => { for (let turn = 0; turn < 50; turn += 1) await Promise.resolve(); });
  const advance = async (ms: number) => {
    act(() => { jest.advanceTimersByTime(ms); });
    await flush();
  };
  await withOpen(() => tab, async () => {
    const view = await reachRecovery(wallet(requests, async () => ({ version: 1, url: "https://example.com/hosted" })));
    const wasServer = environmentManager.isServer();
    environmentManager.setIsServer(() => false);
    jest.useFakeTimers();
    try {
      fireEvent.click(view.getByRole("button", { name: "Continue in a new tab" }));
      await flush();
      expect(tab.location.replace).toHaveBeenCalled();
      fireEvent.click(view.getByRole("button", { name: "Close" }));
      await flush();
      await advance(20 * 60_000);
      const stopped = statusReads();
      await advance(30_000);
      expect(statusReads()).toBe(stopped);
      act(() => { window.dispatchEvent(new Event("focus")); });
      await flush();
      const returned = statusReads();
      for (let tick = 0; tick < 3; tick += 1) await advance(10_000);
      expect(statusReads()).toBeGreaterThanOrEqual(returned + 3);
    } finally {
      jest.useRealTimers();
      environmentManager.setIsServer(() => wasServer);
    }
  });
});
