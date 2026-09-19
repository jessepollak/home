import type { ReactNode } from "react";

export type CardEligibility =
  | "eligible"
  | "verification-required"
  | "verification-pending"
  | "country-unavailable";

export type CardIdentityRequirement =
  | { kind: "none" }
  | { kind: "reuse-accepted"; label: string }
  | { kind: "provider-hosted"; label: string };

export type CardEntryState = {
  kind: "not-issued";
  eligibility: CardEligibility;
  identityRequirement: CardIdentityRequirement;
};

export type CardForm = "virtual" | "physical";
export type CardWalletState = "not-offered" | "eligible" | "provisioned";
export type CardActivityStatus =
  | "settled"
  | "pending"
  | "declined"
  | "reversed"
  | "refunded";

export type CardActivitySummary = {
  id: string;
  merchant: string;
  occurredAt: string;
  amount: string;
  status: CardActivityStatus;
  statusDetail?: string;
};

export type CardControl = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  available?: boolean;
};

export type CardSpendingLimit = {
  label: string;
  value: string;
  detail?: string;
};

export type IssuedCardState = {
  kind: "issued";
  status: "active" | "frozen";
  form: CardForm;
  walletState: CardWalletState;
  availableToSpend: string;
  fundingSource: string;
  allocationLabel: string;
  updatedAt?: string;
  lowFunds?: boolean;
  serviceStatus?: "available" | "outage";
  controls: readonly CardControl[];
  limits: readonly CardSpendingLimit[];
  activity: readonly CardActivitySummary[];
};

export type CardJourneyState = CardEntryState | IssuedCardState;

export type CardExperienceProps = {
  state: CardJourneyState;
  fundingEntry?: (options: { disabled: boolean }) => ReactNode;
  onStartIssuance?: () => void;
  onStartVerification?: () => void;
  onOpenSecureDetails?: () => void;
  onFreezeChange?: (frozen: boolean) => void;
  onControlChange?: (controlId: string, enabled: boolean) => void;
  onRequestWalletProvisioning?: () => void;
  onOpenActivity?: (activityId?: string) => void;
  onContactSupport?: () => void;
};
