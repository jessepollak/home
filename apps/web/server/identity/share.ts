import "server-only";

const recipients: ReadonlyArray<string> = [];

/** @public recipient sharing is unavailable until the explicit #639 integration */
export async function shareIdentityApproval(_customerId: string, recipient: string): Promise<{ outcome: "not-approved" } | { outcome: "unsupported-recipient" }> {
  return { outcome: recipients.includes(recipient) ? "not-approved" : "unsupported-recipient" };
}
