import "../account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { announceActionFailure } from "./action-toast-events";
import { toast } from "@/components/ui/toast";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { ActionToasts } = await import("./action-toasts");

const session: VerifiedAccountSession = {
  user: { subject: "toast-subject" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

const otherSession: VerifiedAccountSession = {
  ...session,
  user: { subject: "other-toast-subject" },
};

afterEach(() => {
  toast.close();
  cleanup();
});

describe("action toast owner fence", () => {
  test("closes all active toasts when the owner boundary changes", async () => {
    const view = render(
      <ActionToasts
        session={session}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );

    act(() => announceActionFailure("send", "Wallet unavailable"));
    expect((await view.findByRole("alert")).textContent).toContain("Send failed: Wallet unavailable");

    view.rerender(
      <ActionToasts
        session={otherSession}
        fetchOperations={async () => ({ actions: [] })}
        dismissAfterMs={0}
      />,
    );

    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
  });
});
