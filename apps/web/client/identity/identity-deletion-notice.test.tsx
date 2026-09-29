import "@/client/account/dom-test-harness";

import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { IdentityVerificationStatus } from "@/shared/identity/contract";
import { IdentityDeletionNotice } from "./identity-deletion-notice";
import { IdentityVerification, type IdentityWallet } from "./identity-verification";

const status: IdentityVerificationStatus = {
  state: "not-started", category: "verification-required", action: "start", verifiedAt: null, retryReason: null, supportUrl: "https://support.example.com/help", consentRequired: true,
};
function wallet(fetchAccountResource: IdentityWallet["fetchAccountResource"]): IdentityWallet {
  return { status: "verified", verification: "server", session: { user: { subject: "owner-a" }, accountProvider: "cdp-embedded", smartAccount: null }, fetchAccountResource };
}
afterEach(() => { cleanup(); getHomeQueryClient().clear(); mock.restore(); });

test("disclosures link to the support URL from the owner's shared identity status query", async () => {
  const fetcher = mock(async () => ({ version: 1, status }));
  const account = wallet(fetcher);
  const view = render(<><ul><IdentityVerification wallet={account} /></ul><IdentityDeletionNotice wallet={account} /></>);
  const link = await waitFor(() => view.getByRole("link", { name: "contact Home support" }));
  expect(link.getAttribute("href")).toBe(status.supportUrl);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(view.getByText(/To request deletion/).textContent).toContain("To request deletion, contact Home support; Home forwards your request to Sumsub");
  expect(view.getByText(/To request deletion/).textContent).toContain("every sign-in linked to your Home profile shares: the Home and Sumsub applicant identifiers, the verification level, the review status and outcome, any retry reason, the consent version and language, and dates for consent, approval, and status updates");
  expect(view.getByText(/To request deletion/).textContent).toContain("If verification was finally declined, Home keeps a record of that decision after a deletion request.");
});

test("disclosures retain plain text when support URL or verified server session is unavailable", async () => {
  const fetcher = mock(async () => ({ version: 1, status: { ...status, supportUrl: null } }));
  const account = wallet(fetcher);
  const view = render(<IdentityDeletionNotice wallet={account} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(view.queryByRole("link", { name: "contact Home support" })).toBeNull();
  expect(view.getByText(/To request deletion/).textContent).toContain("contact Home support");
  view.rerender(<IdentityDeletionNotice wallet={{ ...account, status: "signed-out", session: null }} />);
  expect(view.queryByRole("link", { name: "contact Home support" })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  view.rerender(<IdentityDeletionNotice wallet={null} />);
  expect(view.getByText(/To request deletion/).textContent).toContain("contact Home support");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
