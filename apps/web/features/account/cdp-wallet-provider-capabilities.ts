"use client";

import { useCallback, useRef, useState } from "react";
import {
  BaseAccountConnectorError,
  type BaseAccountInvalidation,
  type ConnectedBaseAccount,
} from "./base-account-connector";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import type { VerifiedAccountSession } from "./session-client";
import type { AccountProvider } from "./session-types";
import {
  ProviderHandleJournal,
  type ProviderHandleJournalLock,
  type ProviderHandleJournalStorage,
} from "@/features/money-actions/provider-handle-journal";

export type AuthenticationIdentity = {
  ownerKey: string | null;
  generation: number;
};

export type AccountSelection =
  | { provider: "restoring"; hint: AccountProvider | null }
  | {
      provider: "pending-authentication";
      attemptedProvider: AccountProvider;
      authentication: AuthenticationIdentity;
    }
  | {
      provider: "blocked-authentication";
      authentication: AuthenticationIdentity | null;
      restoredPendingHint?: true;
    }
  | { provider: "cdp-embedded" }
  | {
      provider: "base-account";
      expectedAddress: `0x${string}`;
      ownerKey: string | null;
      admissionReady: boolean;
    };

type AccountProviderHint = AccountProvider | `pending:${AccountProvider}`;

const ACCOUNT_PROVIDER_HINT_KEY = "home:account-provider";

export function embeddedSelection(): AccountSelection {
  return { provider: "cdp-embedded" };
}

export function initialAccountSelection(): AccountSelection {
  try {
    const hint = window.sessionStorage.getItem(ACCOUNT_PROVIDER_HINT_KEY);
    if (hint === "cdp-embedded" || hint === "base-account") {
      return { provider: "restoring", hint };
    }
    if (hint === "pending:cdp-embedded" || hint === "pending:base-account") {
      return {
        provider: "blocked-authentication",
        authentication: null,
        restoredPendingHint: true,
      };
    }
    if (hint !== null) {
      return { provider: "blocked-authentication", authentication: null };
    }
  } catch {
    // The restored SDK identity can still select one unambiguous provider.
  }
  return { provider: "restoring", hint: null };
}

export function writeAccountProviderHint(provider: AccountProviderHint | null) {
  try {
    if (provider) {
      window.sessionStorage.setItem(ACCOUNT_PROVIDER_HINT_KEY, provider);
    } else {
      window.sessionStorage.removeItem(ACCOUNT_PROVIDER_HINT_KEY);
    }
  } catch {
    // This hint may only restrict restoration; storage is not an auth boundary.
  }
}

export type BaseAccountLoginFailure =
  | "disabled"
  | "cancelled"
  | "account-changed"
  | "chain-changed"
  | "provider-unavailable"
  | "verification-unsupported";

export class BaseAccountLoginError extends Error {
  readonly reason: BaseAccountLoginFailure;

  constructor(reason: BaseAccountLoginFailure, cause?: unknown) {
    super(reason, { cause });
    this.name = "BaseAccountLoginError";
    this.reason = reason;
  }
}

export function baseLoginFailureFromConnector(
  error: BaseAccountConnectorError,
): BaseAccountLoginFailure {
  switch (error.reason) {
    case "cancelled":
      return "cancelled";
    case "account-changed":
      return "account-changed";
    case "chain-changed":
      return "chain-changed";
    default:
      return "provider-unavailable";
  }
}

export async function releaseBaseAccountConnection(
  connection: ConnectedBaseAccount,
): Promise<void> {
  if (connection.release) {
    connection.release();
    return;
  }
  await connection.disconnect();
}

export function invalidationMessage(reason: BaseAccountInvalidation): string {
  switch (reason) {
    case "account-changed":
      return "The connected Base Account changed. Sign in again to continue.";
    case "chain-changed":
      return "The Base Account network changed. Switch to Base and sign in again.";
    default:
      return "The Base Account disconnected. Sign in again to continue.";
  }
}

export function useWalletProviderCapabilities({
  ownerFence,
  providerHandleJournalStorage,
  providerHandleJournalLock,
}: {
  ownerFence: OwnerGenerationFence;
  providerHandleJournalStorage?: ProviderHandleJournalStorage | null;
  providerHandleJournalLock?: ProviderHandleJournalLock | null;
}) {
  const accountSelectionRef = useRef<AccountSelection>(initialAccountSelection());
  const baseConnectionRef = useRef<ConnectedBaseAccount | null>(null);
  const baseLoginInProgressRef = useRef(false);
  const [providerHandleJournal] = useState(
    () => new ProviderHandleJournal({
      storage: providerHandleJournalStorage,
      lock: providerHandleJournalLock,
    }),
  );

  const clearBaseConnection = useCallback(() => {
    baseLoginInProgressRef.current = false;
    const connection = baseConnectionRef.current;
    baseConnectionRef.current = null;
    if (connection) {
      void connection.disconnect();
    }
  }, []);

  const signTypedData = useCallback(
    async (
      typedData: unknown,
      session: VerifiedAccountSession | null,
      status: string,
      ownerKey: string | null,
      authorizationBoundary: string | null,
    ) => {
      if (
        status !== "verified" ||
        !session?.smartAccount ||
        session.accountProvider !== "base-account"
      ) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      const identity = ownerFence.capture(ownerKey, authorizationBoundary);
      const connection = baseConnectionRef.current;
      if (
        !ownerFence.isCurrent(identity) ||
        !connection ||
        connection.address.toLowerCase() !== session.smartAccount.address.toLowerCase()
      ) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      return connection.signTypedData(typedData);
    },
    [ownerFence],
  );

  return {
    accountSelectionRef,
    baseConnectionRef,
    baseLoginInProgressRef,
    providerHandleJournal,
    clearBaseConnection,
    signTypedData,
  };
}

export type WalletProviderCapabilities = ReturnType<
  typeof useWalletProviderCapabilities
>;
