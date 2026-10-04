import "@/client/account/dom-test-harness";
import "./support-chat";

import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient } from "@/client/query/query-client";
import { SupportProvider, useOptionalSupport } from "./support-provider";

type Fetch = AccountWalletClient["fetchAccountResource"];
const noStream: AccountWalletClient["fetchAccountResponse"] = async () => { throw new Error("Unexpected stream"); };

function Probe() {
  const support = useOptionalSupport();
  if (!support) return <p>No support</p>;
  return <><p>Unread {support.unreadCount ?? "unknown"}</p><button type="button" onClick={() => support.openSupport()}>Open support</button></>;
}

function fetchFor(unread: Record<string, number | null>, owner: () => string): Fetch {
  return async (path) => {
    const count = unread[owner()];
    if (path === "/api/support/summary") return count === null ? new Promise(() => {}) : { version: 2, unreadCount: count };
    if (path === "/api/support") return { version: 2, assistant: { available: false, handoff: false }, conversation: null };
    return null;
  };
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

test("an owner switch never shows the previous owner's unread count", async () => {
  let owner = "owner-a";
  const fetch = fetchFor({ "owner-a": 3, "owner-b": null }, () => owner);
  const view = render(<SupportProvider ownerKey={owner} fetchAccountResource={fetch} fetchAccountResponse={noStream}><Probe /></SupportProvider>);
  await view.findByText("Unread 3");
  owner = "owner-b";
  view.rerender(<SupportProvider ownerKey={owner} fetchAccountResource={fetch} fetchAccountResponse={noStream}><Probe /></SupportProvider>);
  expect(view.getByText("Unread unknown")).toBeTruthy();
  view.rerender(<SupportProvider ownerKey={null} fetchAccountResource={fetch} fetchAccountResponse={noStream}><Probe /></SupportProvider>);
  expect(view.getByText("No support")).toBeTruthy();
});

test("an open drawer does not reopen when its owner signs out and back in", async () => {
  const fetch = fetchFor({ "owner-a": 0 }, () => "owner-a");
  const tree = (ownerKey: string | null) => <SupportProvider ownerKey={ownerKey} fetchAccountResource={fetch} fetchAccountResponse={noStream}><Probe /></SupportProvider>;
  const view = render(tree("owner-a"));
  await view.findByText("Unread 0");
  act(() => { view.getByRole("button", { name: "Open support" }).click(); });
  await view.findByRole("dialog", { name: "Support" });
  view.rerender(tree(null));
  await waitFor(() => expect(view.queryByRole("dialog", { name: "Support" })).toBeNull());
  view.rerender(tree("owner-a"));
  await view.findByText("Unread 0");
  expect(view.queryByRole("dialog", { name: "Support" })).toBeNull();
});
