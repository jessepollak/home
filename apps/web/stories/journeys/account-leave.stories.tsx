import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useCallback, useRef, useState } from "react";
import { HttpResponse, http } from "msw";
import { expect, fn, userEvent, spyOn, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { DashboardShell } from "@/client/home/shell";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { AccountDeletionCompletionContext } from "@/client/account/account-deletion-recovery";
import { AccountDeletionReceiptView } from "@/client/account/account-deletion-view";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { ACCOUNT_EXPORT_HOME_CLASSES } from "@/shared/account/contracts/data-export";
import { providerHeldStatement, type AccountDeletionReceipt } from "@/shared/account/contracts/account-deletion";

type Scenario = "review" | "confirm" | "blockers" | "failed" | "completed" | "unavailable" | "refresh-error" | "wallet-free";
const at = "2026-10-07T03:00:00.000Z";
const deletionSubmitted = fn();
function receipt(status: "queued" | "completed", failed = false): AccountDeletionReceipt {
  return {
    version: 1, schema: "home.account-deletion", requestId: "11111111-1111-4111-8111-111111111111",
    status, requestedAt: at, updatedAt: at, completedAt: status === "completed" ? at : null, retentionYears: 5,
    blockers: status === "queued" && !failed ? [{ name: "actions", count: 2 }, { name: "funding_orders", count: 1 }] : [],
    lastAttempt: status === "queued" ? { at, outcome: failed ? "failed" : "blocked" } : null,
    stores: ACCOUNT_EXPORT_HOME_CLASSES.map((name) => status === "queued" ? { name, disposition: "pending" } : ["access_audit", "actions", "cashout_orders", "operator_fees", "funding_orders", "card_accounts", "cards", "card_transactions"].includes(name)
      ? { name, disposition: "retained-pseudonymized", evidence: "Financial records", reason: "Reconciliation and duplicate-success protection", expiresAt: "2031-10-07T03:00:00.000Z" }
      : { name, disposition: "deleted" }),
    providers: [{ provider: "Coinbase", records: "Sign-in records", disposition: "held-by-provider", statement: providerHeldStatement("Coinbase") }],
    publicChain: { disposition: "public-chain-immutable", statement: "Public-chain history cannot be erased." },
  };
}

function AccountLeaveJourney({ scenario = "review" }: { scenario?: Scenario }) {
  const [completed, setCompleted] = useState<AccountDeletionReceipt | null>(scenario === "completed" ? receipt("completed") : null);
  const reads = useRef(0);
  const fetchAccountResource = useCallback<AccountWalletClient["fetchAccountResource"]>(async (path, options) => {
    if (path === "/api/support/summary") return { version: 2, unreadCount: 0 };
    if (path === "/api/invites/link") return { version: 1, code: "abcdefghjk" };
    if (path === "/api/account/deletion") {
      if (scenario === "refresh-error" && ++reads.current > 1) throw new Error("Refresh unavailable");
      if (scenario === "refresh-error") return receipt("queued");
      if (scenario === "unavailable") throw new Error("Unavailable");
      if (scenario === "blockers" || scenario === "failed") return receipt("queued", scenario === "failed");
      if (options?.method === "POST") {
        deletionSubmitted();
        return receipt("queued");
      }
      return { error: { code: "ACCOUNT_DELETION_NOT_FOUND", message: "No request" } };
    }
    throw new Error("Unexpected story request");
  }, [scenario]);
  const session: VerifiedAccountSession = { user: { subject: "leave-story-owner" }, smartAccount: scenario === "wallet-free" ? null : { address: "0x1111111111111111111111111111111111111111", chainId: 8453 }, accountProvider: "cdp-embedded" };
  const wallet: AccountWalletClient = { ...createBlockedAccountWalletClient("provider-unavailable"), status: "verified", verification: "server", isSignedIn: true, ownerKey: "leave-story-owner", session, fetchAccountResource,
    fetchOperations: async () => ({ version: 1, operations: [] }),
  };
  return <AccountWalletClientProvider client={wallet}>
    {completed ? <AccountDeletionReceiptView receipt={completed} deviceRows={[
      { name: "Query cache", cleared: true }, { name: "IndexedDB owner cache", cleared: true },
      { name: "Restored query cache", cleared: true }, { name: "Home summary cookie", cleared: true },
      { name: "Device preferences and Home storage", cleared: true },
    ]} /> : <AccountDeletionCompletionContext.Provider value={setCompleted}>
      <DashboardShell initialAccountSettingsOpen region={{ regionId: "US", selectRegion: () => {}, resolutionSource: "persisted", preferenceMessage: "", isPreferenceReady: true, offeredCountries: ["US"] }} />
    </AccountDeletionCompletionContext.Provider>}
  </AccountWalletClientProvider>;
}
const meta = {
  title: "Journeys/Account leave", component: AccountLeaveJourney,
  parameters: { a11y: { test: "error" }, viewport: { defaultViewport: "mobile" }, msw: { handlers: [http.get("https://api.ensideas.com/*", () => HttpResponse.json({ name: "leave.base.eth" })), http.post("/api/client-performance", () => new HttpResponse(null, { status: 204 }))] } },
} satisfies Meta<typeof AccountLeaveJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Review: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Leave Home" }));
    await expect(await canvas.findByRole("button", { name: "Delete my Home account" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Export my data" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Back" }));
    await expect(canvas.getByRole("region", { name: "Your data" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Leave Home" }));
  },
};
export const Confirm: Story = {
  args: { scenario: "confirm" },
  play: async ({ canvasElement }) => {
    deletionSubmitted.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Leave Home" }));
    const deleteButton = await canvas.findByRole("button", { name: "Delete my Home account" });
    await waitForReady(() => expect(deleteButton).toBeEnabled());
    await userEvent.click(deleteButton);
    const body = within(canvasElement.ownerDocument.body);
    const sheet = await body.findByRole("dialog", { name: "Delete your Home account?" });
    const dialog = within(sheet);
    await expect(dialog.getByText("This can’t be undone.")).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Confirm deletion" });
    const cancel = dialog.getByRole("button", { name: "Cancel deletion" });
    await expect(confirm).toBeEnabled();
    await expect(dialog.getAllByRole("button")).toEqual([confirm, cancel]);
    await waitForReady(async () => {
      await expect(cancel).toHaveFocus();
      await expect(confirm.getBoundingClientRect().bottom).toBeLessThanOrEqual(cancel.getBoundingClientRect().top);
    });
    await userEvent.click(dialog.getByRole("button", { name: "Cancel deletion" }));
    await waitForReady(() => expect(sheet).not.toBeVisible());
    await waitForReady(() => expect(deleteButton).toHaveFocus());
    await expect(canvas.queryByRole("heading", { name: "Deletion queued" })).toBeNull();
    await expect(deletionSubmitted).not.toHaveBeenCalled();
    await userEvent.click(deleteButton);
    const reopened = within(await body.findByRole("dialog", { name: "Delete your Home account?" }));
    await waitForReady(() => expect(reopened.getByRole("button", { name: "Cancel deletion" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitForReady(() => expect(deleteButton).toHaveFocus());
    await expect(deletionSubmitted).not.toHaveBeenCalled();
    await userEvent.click(deleteButton);
    const finalSheet = within(await body.findByRole("dialog", { name: "Delete your Home account?" }));
    await waitForReady(() => expect(finalSheet.getByRole("button", { name: "Cancel deletion" })).toHaveFocus());
    await expect(finalSheet.getByRole("button", { name: "Confirm deletion" })).toBeEnabled();
  },
};
export const QueuedWithBlockers: Story = {
  args: { scenario: "blockers" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Leave Home" }));
    await expect(await canvas.findByRole("heading", { name: "Deletion queued" })).toBeVisible();
    await expect(canvas.getByText("2 money actions still pending")).toBeVisible();
    await expect(canvas.getByText("Waiting for pending money items to settle.")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Check status" })).toBeNull();
    await expect(canvas.getByRole("banner").querySelector("[data-shell-back] button")).not.toBeNull();
  },
};
export const QueuedWithFailedAttempt: Story = {
  args: { scenario: "failed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Leave Home" }));
    await expect(await canvas.findByText("The last attempt failed. Your Home account has not been deleted.")).toBeVisible();
    await expect(canvas.queryByRole("heading", { name: "Home account deleted" })).toBeNull();
  },
};
export const CompletedReceipt: Story = {
  args: { scenario: "completed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Home account deleted" })).toBeVisible();
    await expect(canvas.getByText("Sign-in records — held by Coinbase, not deleted by Home")).toBeVisible();
    await expect(canvas.getAllByText("Cleared on this device")).toHaveLength(5);
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Download receipt" }));
      await expect(click).toHaveBeenCalledTimes(1);
    } finally { click.mockRestore(); }
  },
};
export const UnavailableError: Story = {
  args: { scenario: "unavailable" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Leave Home" }));
    await expect(await canvas.findByText("Couldn't check your deletion request. Deletion is not confirmed.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Delete my Home account" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeEnabled();
  },
};
export const QueuedRefreshFailure: Story = {
  args: { scenario: "refresh-error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Leave Home" }));
    await expect(await canvas.findByRole("heading", { name: "Deletion queued" })).toBeVisible();
    canvasElement.ownerDocument.dispatchEvent(new Event("visibilitychange"));
    await expect(await canvas.findByText("Couldn't refresh. Deletion is still queued. We’ll retry automatically.")).toBeVisible();
    await expect(canvas.queryByRole("heading", { name: "Home account deleted" })).toBeNull();
  },
};
export const WalletFreeReview: Story = {
  args: { scenario: "wallet-free" },
  play: Review.play,
};
