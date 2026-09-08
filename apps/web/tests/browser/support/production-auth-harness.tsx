import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountSignInSheet } from "../../../features/account/account-screen";
import {
  AccountWalletSessionOwner,
  useAccountWallet,
  type AccountWalletSdkBoundary,
} from "../../../features/account/cdp-client";
import {
  BaseAccountConnectorError,
  type BaseAccountInvalidation,
  type ConnectedBaseAccount,
} from "../../../features/account/base-account-connector";

const FIXTURE_ADDRESS = "0x1111111111111111111111111111111111111111" as const;
type Scenario =
  | "email-basic"
  | "email-old-owner"
  | "base-click"
  | "base-invalidation"
  | "base-503"
  | "base-fast-session";

type HarnessControl = {
  arriveOwner: (ownerKey?: string) => void;
  releaseEmailVerification: () => void;
  releaseFinalBaseAssert: () => void;
  releaseSiweVerification: () => void;
  triggerBaseInvalidation: (reason?: BaseAccountInvalidation) => void;
  events: string[];
};

declare global {
  interface Window {
    authHarness: HarnessControl;
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function HarnessContents({ onVerified }: { onVerified: () => void }) {
  const account = useAccountWallet();
  const [open, setOpen] = useState(false);

  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>
        Open account
      </button>
      <output data-testid="session-status">{account.status}</output>
      <output data-testid="private-address">
        {account.session?.smartAccount?.address ?? "private-details-hidden"}
      </output>
      <output data-testid="session-message">{account.message ?? ""}</output>
      <button type="button" onClick={() => void account.signOut().catch(() => {})}>
        Sign out fixture session
      </button>
      <AccountSignInSheet
        open={open}
        onClose={() => setOpen(false)}
        onVerified={onVerified}
      />
    </main>
  );
}

function ProductionAuthHarness() {
  const scenario = new URLSearchParams(window.location.search).get("scenario") as Scenario;
  const [sdkOwner, setSdkOwner] = useState<string | null>(null);
  const [providerPending, setProviderPending] = useState(false);
  const [providerConfirmations, setProviderConfirmations] = useState(0);
  const [route, setRoute] = useState("/");
  const events = useRef<string[]>([]);
  const emailVerification = useRef(deferred());
  const finalBaseAssert = useRef(deferred());
  const siweVerification = useRef(deferred());
  const resolveProvider = useRef<((connection: ConnectedBaseAccount) => void) | null>(null);
  const invalidateBase = useRef<((reason: BaseAccountInvalidation) => void) | null>(null);
  const invalidated = useRef<BaseAccountInvalidation | null>(null);
  const baseAssertCount = useRef(0);

  const arriveOwner = (ownerKey = "fixture-owner") => {
    events.current.push(`owner:${ownerKey}`);
    setSdkOwner(ownerKey);
  };

  const sdk = useMemo<AccountWalletSdkBoundary>(
    () => ({
      isInitialized: true,
      isSignedIn: sdkOwner !== null,
      ownerKey: sdkOwner,
      signInWithEmail: async (email) => {
        events.current.push(`email:${email}`);
        return { flowId: `flow-${email}` };
      },
      verifyEmailOTP: async (_flowId, otp) => {
        events.current.push(`otp:${otp}`);
        if (scenario === "email-old-owner") {
          await emailVerification.current.promise;
          return;
        }
        arriveOwner("email-owner");
      },
      signInWithSiwe: async () => ({
        flowId: "fixture-siwe-flow",
        message: "fixture SIWE challenge",
      }),
      verifySiweSignature: async () => {
        events.current.push("siwe:verifying");
        if (scenario === "base-invalidation") {
          await siweVerification.current.promise;
        }
        events.current.push("siwe:verified");
        if (
          scenario === "base-503" ||
          scenario === "base-fast-session"
        ) {
          arriveOwner("base-owner");
        }
      },
      getAccessToken: async () => (sdkOwner ? "fixture-access-token" : null),
      signOut: async () => {
        events.current.push("sdk:sign-out");
        setSdkOwner(null);
      },
    }),
    [scenario, sdkOwner],
  );

  const baseAccountConnector = useCallback(
    async (
      onInvalidated: (reason: BaseAccountInvalidation) => void,
    ): Promise<ConnectedBaseAccount> => {
      events.current.push("base:connector-opened");
      invalidateBase.current = (reason) => {
        invalidated.current = reason;
        events.current.push(`base:invalidated:${reason}`);
        onInvalidated(reason);
      };
      setProviderPending(true);

      return new Promise<ConnectedBaseAccount>((resolve) => {
        resolveProvider.current = resolve;
      });
    },
    [],
  );

  const connectedBaseAccount = (): ConnectedBaseAccount => ({
    address: FIXTURE_ADDRESS,
    assertUnchanged: async () => {
      baseAssertCount.current += 1;
      events.current.push(`base:assert:${baseAssertCount.current}`);
      if (scenario === "base-fast-session" && baseAssertCount.current === 4) {
        await finalBaseAssert.current.promise;
      }
      if (invalidated.current) {
        throw new BaseAccountConnectorError(invalidated.current);
      }
    },
    signMessage: async () => {
      events.current.push("base:provider-confirmed");
      return "0x1234";
    },
    signTypedData: async () => `0x${"cd".repeat(65)}`,
    disconnect: async () => {
      events.current.push("base:disconnect");
    },
  });

  const sessionFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      events.current.push("session:request");
      const endpoint = new URL(String(input), window.location.origin);
      endpoint.searchParams.set("scenario", scenario);
      return fetch(endpoint, init);
    },
    [scenario],
  );

  useEffect(() => {
    window.authHarness = {
      arriveOwner,
      releaseEmailVerification: () => emailVerification.current.resolve(),
      releaseFinalBaseAssert: () => finalBaseAssert.current.resolve(),
      releaseSiweVerification: () => siweVerification.current.resolve(),
      triggerBaseInvalidation: (reason = "disconnected") => {
        invalidateBase.current?.(reason);
      },
      events: events.current,
    };
  });

  return (
    <AccountWalletSessionOwner
      sdk={sdk}
      sessionFetch={sessionFetch}
      baseAccountEnabled
      baseAccountConnector={baseAccountConnector}
    >
      <output data-testid="observed-route">{route}</output>
      <output data-testid="provider-confirmations">{providerConfirmations}</output>
      {providerPending ? (
        <button
          type="button"
          onClick={() => {
            setProviderConfirmations((value) => value + 1);
            setProviderPending(false);
            resolveProvider.current?.(connectedBaseAccount());
          }}
        >
          Mock provider confirmation
        </button>
      ) : null}
      <HarnessContents onVerified={() => setRoute("/dashboard")} />
    </AccountWalletSessionOwner>
  );
}

createRoot(document.getElementById("root")!).render(<ProductionAuthHarness />);
