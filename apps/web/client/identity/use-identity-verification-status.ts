import type { AccountWalletClient } from "@/client/account/cdp-client";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { IDENTITY_HOSTED_LINK_TTL_SECONDS, readIdentityVerificationStatus, type IdentityVerificationStatus } from "@/shared/identity/contract";

export type IdentityWallet = Pick<AccountWalletClient, "status" | "verification" | "session" | "fetchAccountResource">;

export function identityOwner(wallet: IdentityWallet | null): string | null {
  const session = wallet?.status === "verified" && wallet.verification === "server" ? wallet.session : null;
  return session ? `${session.accountProvider}\u0000${session.user.subject}` : null;
}

const reviewPollMs = 10_000;
const submissionPollWindowMs = 15 * 60_000;
const reviewStates: ReadonlySet<IdentityVerificationStatus["state"]> = new Set(["pending", "manual-review"]);
function awaitsReview(status: IdentityVerificationStatus | undefined): boolean {
  return status !== undefined && reviewStates.has(status.state);
}
const applicantlessStates: ReadonlySet<IdentityVerificationStatus["state"]> = new Set(["not-started", "removed"]);

const submittedStates: ReadonlySet<IdentityVerificationStatus["state"]> = new Set(["in-progress", "reset", "level-changed", "retry", "temporarily-unavailable"]);

export function identityPollInterval(status: IdentityVerificationStatus | undefined, submittedAt: number | null, now: number): number | false {
  if (awaitsReview(status)) return reviewPollMs;
  const awaitingWebhook = submittedAt !== null && now - submittedAt < submissionPollWindowMs;
  return awaitingWebhook && status !== undefined && submittedStates.has(status.state) ? reviewPollMs : false;
}

export function hostedReturnRearmsPolling(linkOpenedAt: number | null, now: number): boolean {
  return linkOpenedAt !== null && now - linkOpenedAt < IDENTITY_HOSTED_LINK_TTL_SECONDS * 1000 + submissionPollWindowMs;
}

export function useIdentityVerificationStatus(wallet: IdentityWallet, owner: string, submittedAt: number | null = null) {
  return useHomeQuery<IdentityVerificationStatus>({
    queryKey: ownerQueryKey(owner, "identity-verification"),
    meta: ownerQueryMeta(owner, "memory"),
    retry: false,
    refetchOnWindowFocus: (current) => (current.state.data && applicantlessStates.has(current.state.data.state) ? false : "always"),
    refetchInterval: (current) => identityPollInterval(current.state.data, submittedAt, Date.now()),
    queryFn: async ({ signal }) => {
      const value = await wallet.fetchAccountResource("/api/identity/verification", { signal });
      const parsed = readIdentityVerificationStatus(value);
      if (!parsed) throw new Error("Identity status unavailable");
      return parsed;
    },
  });
}
