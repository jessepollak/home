import "./dom-test-harness";

import { useState } from "react";
import { afterEach, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createBlockedAccountWalletClient, AccountWalletContext } from "./cdp-client";
import { OwnerBoundary } from "./owner-boundary";

const { cleanup, fireEvent, render } = await import("@testing-library/react");

const blocked = createBlockedAccountWalletClient("unconfigured");
function wallet(subject: string) {
  const session: VerifiedAccountSession = {
    user: { subject },
    smartAccount: { address: subject === "A" ? "0x1111111111111111111111111111111111111111" : "0x2222222222222222222222222222222222222222", chainId: 8453 },
    accountProvider: "cdp-embedded",
  };
  return { ...blocked, status: "verified" as const, verification: "server" as const, ownerKey: subject, session };
}
const walletA = wallet("A");
const walletB = wallet("B");
function Selection() {
  const [selected, setSelected] = useState(false);
  return <button onClick={() => setSelected(true)}>{selected ? "Selected" : "Fresh"}</button>;
}
function Surface({ owner }: { owner: "A" | "B" | null }) {
  return <AccountWalletContext.Provider value={owner === "A" ? walletA : owner === "B" ? walletB : blocked}>
    <OwnerBoundary><Selection /></OwnerBoundary>
  </AccountWalletContext.Provider>;
}
afterEach(cleanup);

test("keeps local state for the same owner and resets on A to B to A", () => {
  const view = render(<Surface owner="A" />);
  fireEvent.click(view.getByRole("button", { name: "Fresh" }));
  view.rerender(<Surface owner="A" />);
  expect(view.getByRole("button", { name: "Selected" })).toBeTruthy();
  view.rerender(<Surface owner="B" />);
  expect(view.getByRole("button", { name: "Fresh" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Fresh" }));
  view.rerender(<Surface owner="A" />);
  expect(view.getByRole("button", { name: "Fresh" })).toBeTruthy();
});

test("resets local state on A to signed-out to A", () => {
  const view = render(<Surface owner="A" />);
  fireEvent.click(view.getByRole("button", { name: "Fresh" }));
  view.rerender(<Surface owner={null} />);
  expect(view.getByRole("button", { name: "Fresh" })).toBeTruthy();
  view.rerender(<Surface owner="A" />);
  expect(view.getByRole("button", { name: "Fresh" })).toBeTruthy();
});
