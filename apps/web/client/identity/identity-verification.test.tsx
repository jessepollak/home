import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { IdentityVerificationStatus, IdentityVerificationState } from "@/shared/identity/contract";
import { IdentityRow } from "./identity-row";
import { IdentityVerification, type IdentityWallet } from "./identity-verification";

const sample: IdentityVerificationStatus = {
  state: "not-started", category: "verification-required", action: "start", verifiedAt: null, retryReason: null, supportUrl: null, consentRequired: false,
};
const titles: Record<IdentityVerificationState, string> = {
  "not-started": "Not verified", "in-progress": "In progress — continue", pending: "Checking your details", "manual-review": "Under review", verified: "Verified", retry: "Needs more from you", rejected: "Verification could not be approved", blocked: "Verification unavailable", "duplicate-person": "You've verified with another account", reset: "In progress — continue", removed: "Your verification was removed by Sumsub.", "level-changed": "In progress — continue", "temporarily-unavailable": "Temporarily unavailable", "configuration-unavailable": "Identity verification isn't available right now",
};
function status(state: IdentityVerificationState, consentRequired = state === "not-started" || state === "removed"): IdentityVerificationStatus { return { ...sample, state, consentRequired }; }
function wallet(owner: string, fetcher: IdentityWallet["fetchAccountResource"]): IdentityWallet {
  return { status: "verified", verification: "server", session: { user: { subject: owner }, accountProvider: "cdp-embedded", smartAccount: null }, fetchAccountResource: fetcher };
}
function renderVerification(state: IdentityVerificationState, fetcher?: IdentityWallet["fetchAccountResource"]) {
  return render(<ul><IdentityVerification wallet={wallet("owner-a", fetcher ?? (async () => ({ version: 1, status: status(state) })))} /></ul>);
}
afterEach(() => { cleanup(); getHomeQueryClient().clear(); mock.restore(); });

describe("identity status row", () => {
  for (const state of Object.keys(titles) as IdentityVerificationState[]) {
    test(`shows ${state} without unsafe details`, () => {
      const view = render(<ul><li><IdentityRow status={status(state)} onAction={() => {}} /></li></ul>);
      expect(view.getAllByText(titles[state]).length).toBeGreaterThan(0);
      expect(view.queryByText("FORGERY")).toBeNull();
      const actionable = ["not-started", "in-progress", "retry", "reset", "removed", "level-changed", "temporarily-unavailable"].includes(state);
      expect(view.queryAllByRole("button").length).toBe(actionable ? 1 : 0);
    });
  }
  test("shows verified date in UTC and safe retry reason", () => {
    const view = render(<ul><li><IdentityRow status={{ ...status("verified"), verifiedAt: "2026-09-07T23:30:00.000Z" }} onAction={() => {}} /></li></ul>);
    expect(view.getByText(/Sep 7, 2026/)).toBeTruthy();
    view.rerender(<ul><li><IdentityRow status={{ ...status("retry"), retryReason: "photo-quality" }} onAction={() => {}} /></li></ul>);
    expect(view.getByText("Use a clearer photo of your document.")).toBeTruthy();
  });
  for (const state of ["rejected", "blocked"] as const) test(`${state} exposes only support link, never a reason`, () => {
    const view = render(<ul><li><IdentityRow status={{ ...status(state), action: "contact-support", supportUrl: "https://support.example.com/help" }} onAction={() => {}} /></li></ul>);
    expect(view.getByRole("link", { name: "Contact Home support" }).getAttribute("href")).toBe("https://support.example.com/help");
    expect(view.queryByRole("button")).toBeNull();
  });
});

describe("identity flow", () => {
  test("blocked identity has no session or link action", async () => {
    const requests: string[] = [];
    const view = renderVerification("blocked", async (path) => {
      requests.push(path);
      return { version: 1, status: { ...status("blocked", false), action: "contact-support", category: "verification-rejected", supportUrl: "https://support.example.com" } };
    });
    await waitFor(() => expect(view.getByText("Verification unavailable")).toBeTruthy());
    expect(view.queryByRole("button")).toBeNull();
    expect(view.getByRole("link", { name: "Contact Home support" })).toBeTruthy();
    expect(requests).toEqual(["/api/identity/verification"]);
  });
  test("requires consent for first session and sends consent true", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const view = renderVerification("not-started", async (path, options) => {
      requests.push({ path, body: options?.body });
      return path.endsWith("/session") ? { version: 1, token: "fixture-token", status: status("in-progress") } : { version: 1, status: status("not-started") };
    });
    await waitFor(() => expect(view.getByRole("button", { name: "Verify identity" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Verify identity" }));
    expect(view.getByText(/Sumsub collects and holds your ID documents and biometric data/)).toBeTruthy();
    expect(view.getByRole("link", { name: "Disclosures & terms" }).getAttribute("href")).toBe("#identity-disclosures");
    expect(requests.filter((request) => request.path.endsWith("/session"))).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(requests.find((request) => request.path.endsWith("/session"))?.body).toEqual({ consent: true, locale: "en" }));
  });
  test("a changed level asks for consent again before continuing", async () => {
    const requests: unknown[] = [];
    const view = renderVerification("level-changed", async (path, options) => {
      if (path.endsWith("/session")) { requests.push(options?.body); return { version: 1, token: "fixture-token", status: status("in-progress", false) }; }
      return { version: 1, status: status("level-changed", true) };
    });
    await waitFor(() => expect(view.getByRole("button", { name: "Continue" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    expect(view.getByText(/Sumsub collects and holds/)).toBeTruthy();
    expect(requests).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(requests).toEqual([{ consent: true, locale: "en" }]));
  });
  test("continuing an existing flow skips consent", async () => {
    const requests: unknown[] = [];
    const view = renderVerification("in-progress", async (path, options) => {
      if (path.endsWith("/session")) { requests.push(options?.body); return { version: 1, token: "fixture-token", status: status("in-progress") }; }
      return { version: 1, status: status("in-progress") };
    });
    await waitFor(() => expect(view.getByRole("button", { name: "Continue" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(requests).toEqual([{}]));
    expect(view.queryByText(/Sumsub collects and holds/)).toBeNull();
  });
  test("409 refetches the authoritative status; 503 is not a rejection", async () => {
    let reads = 0;
    const view = renderVerification("in-progress", async (path) => {
      if (path.endsWith("/session")) throw Object.assign(new Error("conflict"), { status: 409 });
      reads += 1;
      return { version: 1, status: status(reads === 1 ? "in-progress" : "pending") };
    });
    await waitFor(() => expect(view.getByRole("button", { name: "Continue" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(view.getByText("Checking your details")).toBeTruthy());
    expect(view.queryByText("Verification could not be approved")).toBeNull();
  });
  test("consent required after removal refetches into the renewed-consent state", async () => {
    let reads = 0;
    const view = renderVerification("in-progress", async (path) => {
      if (path.endsWith("/session")) throw Object.assign(new Error("consent"), { status: 400, code: "CONSENT_REQUIRED" });
      reads += 1;
      return { version: 1, status: status(reads === 1 ? "in-progress" : "removed") };
    });
    await waitFor(() => expect(view.getByRole("button", { name: "Continue" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Verify again" })).toBeTruthy());
    expect(view.queryByText("Temporarily unavailable")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Verify again" }));
    await waitFor(() => expect(view.getByText(/Sumsub collects and holds/)).toBeTruthy());
  });
  test("503 configuration failure shows non-rejection unavailability", async () => {
    const view = renderVerification("in-progress", async (path) => {
      if (path.endsWith("/session")) throw Object.assign(new Error("unavailable"), { status: 503, code: "IDENTITY_CONFIGURATION_UNAVAILABLE" });
      return { version: 1, status: status("in-progress") };
    });
    await waitFor(() => expect(view.getByRole("button", { name: "Continue" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(view.getByText("Identity verification isn't available right now")).toBeTruthy());
    expect(view.queryByText("Verification could not be approved")).toBeNull();
  });
  test("parse failure is retryable and never rejected", async () => {
    const view = renderVerification("not-started", async () => ({}));
    await waitFor(() => expect(view.getByRole("button", { name: "Try again" })).toBeTruthy());
    expect(view.queryByText("Verification could not be approved")).toBeNull();
  });
  test("regaining focus while awaiting review shows the asynchronous decision", async () => {
    getHomeQueryClient().mount();
    let reads = 0;
    const view = renderVerification("pending", async () => {
      reads += 1;
      return { version: 1, status: status(reads === 1 ? "pending" : "verified") };
    });
    await waitFor(() => expect(view.getByText("Checking your details")).toBeTruthy());
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(view.getByText("Verified")).toBeTruthy());
    focusManager.setFocused(undefined);
    getHomeQueryClient().unmount();
  });
  test("regaining focus on a verified status shows a provider revocation", async () => {
    getHomeQueryClient().mount();
    let reads = 0;
    const view = renderVerification("verified", async () => {
      reads += 1;
      return { version: 1, status: status(reads === 1 ? "verified" : "removed") };
    });
    await waitFor(() => expect(view.getByText("Verified")).toBeTruthy());
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(view.getByText("Your verification was removed by Sumsub.")).toBeTruthy());
    focusManager.setFocused(undefined);
    getHomeQueryClient().unmount();
  });
  test("regaining focus after deactivation shows an operator reactivation", async () => {
    getHomeQueryClient().mount();
    let reads = 0;
    const view = renderVerification("blocked", async () => {
      reads += 1;
      return { version: 1, status: status(reads === 1 ? "blocked" : "verified") };
    });
    await waitFor(() => expect(view.getByText("Verification unavailable")).toBeTruthy());
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(view.getByText("Verified")).toBeTruthy());
    focusManager.setFocused(undefined);
    getHomeQueryClient().unmount();
  });
  test("regaining focus on a duplicate-person status shows a provider reset", async () => {
    getHomeQueryClient().mount();
    let reads = 0;
    const view = renderVerification("duplicate-person", async () => {
      reads += 1;
      return { version: 1, status: status(reads === 1 ? "duplicate-person" : "verified") };
    });
    await waitFor(() => expect(view.getByText("You've verified with another account")).toBeTruthy());
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(view.getByText("Verified")).toBeTruthy());
    focusManager.setFocused(undefined);
    getHomeQueryClient().unmount();
  });
  test("states without a provider applicant do not refetch on focus", async () => {
    getHomeQueryClient().mount();
    let reads = 0;
    const view = renderVerification("not-started", async () => {
      reads += 1;
      return { version: 1, status: status("not-started") };
    });
    await waitFor(() => expect(view.getByText("Not verified")).toBeTruthy());
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
    getHomeQueryClient().unmount();
    expect(reads).toBe(1);
  });
  test("owner switch never shows the previous owner's status and scopes query keys", async () => {
    const first = wallet("one", async () => ({ version: 1, status: status("verified") }));
    const second = wallet("two", async () => ({ version: 1, status: status("not-started") }));
    const view = render(<ul><IdentityVerification wallet={first} /></ul>);
    await waitFor(() => expect(view.getByText("Verified")).toBeTruthy());
    view.rerender(<ul><IdentityVerification wallet={second} /></ul>);
    expect(view.queryByText("Verified")).toBeNull();
    await waitFor(() => expect(view.getByRole("button", { name: "Verify identity" })).toBeTruthy());
    expect(getHomeQueryClient().getQueryData(ownerQueryKey("cdp-embedded\u0000one", "identity-verification"))).toBeTruthy();
    expect(getHomeQueryClient().getQueryData(ownerQueryKey("cdp-embedded\u0000two", "identity-verification"))).toBeTruthy();
  });
  test("signed out does not fetch or show a row", () => {
    const fetcher = mock(async () => ({ version: 1, status: sample }));
    const view = render(<ul><IdentityVerification wallet={{ ...wallet("one", fetcher), status: "signed-out", session: null }} /></ul>);
    expect(view.queryByText("Identity")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
