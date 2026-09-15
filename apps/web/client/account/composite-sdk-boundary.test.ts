import { describe, expect, test } from "bun:test";
import type { AccountWalletSdkBoundary } from "./cdp-client";
import { composeSdkBoundaries, type CompositeSdkBoundaryInput } from "./composite-sdk-boundary";
import type { VerifiedAccountSession } from "./session-client";

const NATIVE_ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const CDP_ADDRESS = "0x2222222222222222222222222222222222222222" as const;

function session(
  accountProvider: VerifiedAccountSession["accountProvider"],
  subject: string,
  address: `0x${string}`,
): VerifiedAccountSession {
  return {
    user: { subject },
    smartAccount: { address, chainId: 8453 },
    accountProvider,
  };
}

function boundary(overrides: Partial<AccountWalletSdkBoundary> = {}): AccountWalletSdkBoundary {
  return {
    authentication: "cdp",
    isInitialized: true,
    isSignedIn: false,
    ownerKey: null,
    provisionalSession: null,
    signInWithEmail: async () => ({ flowId: "email-flow" }),
    verifyEmailOTP: async () => {},
    requestBaseAccountChallenge: async () => ({
      nonce: "a".repeat(48), chainId: 8453, domain: "home.example", uri: "https://home.example",
      version: "1", statement: "Sign in to Home.", issuedAt: "2026-09-13T12:00:00.000Z",
      expirationTime: "2026-09-13T12:05:00.000Z",
    }),
    verifyBaseAccountProof: async () => {},
    getAccessToken: async () => "token",
    signOut: async () => {},
    ...overrides,
  };
}

function input(overrides: {
  waitForCdpRestore?: boolean;
  waitForBaseRestore?: boolean;
  cdp?: Partial<AccountWalletSdkBoundary>;
  identity?: VerifiedAccountSession | null;
  native?: Partial<AccountWalletSdkBoundary>;
  isSettled?: boolean;
  hasSettled?: boolean;
  initializationError?: "provider-unavailable";
  restore?: () => Promise<void>;
  clearNative?: CompositeSdkBoundaryInput["clearNative"];
  cdpSignOut?: CompositeSdkBoundaryInput["cdpSignOut"];
  retryCdp?: CompositeSdkBoundaryInput["retryCdp"];
  shouldSignOutCdp?: () => boolean;
} = {}): CompositeSdkBoundaryInput {
  const identity = overrides.identity ?? null;
  const isSettled = overrides.isSettled ?? true;
  return {
    restorePlanCaptured: true,
    waitForCdpRestore: overrides.waitForCdpRestore ?? false,
    waitForBaseRestore: overrides.waitForBaseRestore ?? false,
    cdp: boundary(overrides.cdp),
    native: {
      boundary: boundary({
        authentication: "native-base",
        ownerKey: identity ? "native-owner" : null,
        provisionalSession: identity,
        isSignedIn: identity !== null,
        getAccessToken: async () => null,
        ...overrides.native,
      }),
      identity,
      isSettled,
      hasSettled: overrides.hasSettled ?? isSettled,
      initializationError: overrides.initializationError,
      restore: overrides.restore ?? (async () => {}),
    },
    clearNative: overrides.clearNative ?? (async () => {}),
    cdpSignOut: overrides.cdpSignOut ?? (async () => {}),
    retryCdp: overrides.retryCdp ?? (async () => {}),
    shouldSignOutCdp: overrides.shouldSignOutCdp ?? (() => true),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const nativeSession = session("base-account", "native-subject", NATIVE_ADDRESS);
const cdpSession = session("cdp-embedded", "cdp-subject", CDP_ADDRESS);

const rows: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: "blocks readiness until the post-mount restore plan is captured",
    run: async () => {
      const pending = input();
      pending.restorePlanCaptured = false;
      const sdk = composeSdkBoundaries(pending);
      expect(sdk.isInitialized).toBe(false);
      expect(sdk.isSignedIn).toBe(false);
    },
  },
  {
    name: "settles signed out without a CDP hint after native restore",
    run: async () => {
      const sdk = composeSdkBoundaries(input({
        cdp: { isInitialized: false, isSignedIn: true, ownerKey: "cdp-owner", provisionalSession: cdpSession },
      }));
      expect({
        isInitialized: sdk.isInitialized,
        isSignedIn: sdk.isSignedIn,
        ownerKey: sdk.ownerKey,
      }).toEqual({ isInitialized: true, isSignedIn: false, ownerKey: null });
    },
  },
  {
    name: "surfaces native identity before CDP initializes",
    run: async () => {
      const sdk = composeSdkBoundaries(input({
        waitForCdpRestore: true,
        cdp: { isInitialized: false, isSignedIn: true, ownerKey: "cdp-owner", provisionalSession: cdpSession },
        identity: nativeSession,
      }));
      expect({
        authentication: sdk.authentication,
        isInitialized: sdk.isInitialized,
        isSignedIn: sdk.isSignedIn,
        ownerKey: sdk.ownerKey,
      }).toEqual({
        authentication: "native-base",
        isInitialized: true,
        isSignedIn: true,
        ownerKey: "native-owner",
      });
    },
  },
  {
    name: "waits for CDP initialization only when a CDP restore hint exists",
    run: async () => {
      const waiting = composeSdkBoundaries(input({
        waitForCdpRestore: true,
        cdp: { isInitialized: false },
      }));
      expect(waiting.isInitialized).toBe(false);
      const settled = composeSdkBoundaries(input({
        waitForCdpRestore: true,
        cdp: { isInitialized: true, isSignedIn: false },
      }));
      expect(settled.isInitialized).toBe(true);
      expect(settled.isSignedIn).toBe(false);
    },
  },

  {
    name: "gives native identity fixed priority without side effects",
    run: async () => {
      let cdpSignOuts = 0;
      const sdk = composeSdkBoundaries(input({
        cdp: { isSignedIn: true, ownerKey: "cdp-owner", provisionalSession: cdpSession },
        identity: nativeSession,
        cdpSignOut: async () => { cdpSignOuts += 1; },
      }));
      expect({
        authentication: sdk.authentication,
        isSignedIn: sdk.isSignedIn,
        ownerKey: sdk.ownerKey,
        provisionalSession: sdk.provisionalSession,
      }).toEqual({
        authentication: "native-base",
        isSignedIn: true,
        ownerKey: "native-owner",
        provisionalSession: nativeSession,
      });
      expect(await sdk.getAccessToken()).toBeNull();
      await Promise.resolve();
      expect(cdpSignOuts).toBe(0);
    },
  },
  {
    name: "exports the settled CDP identity and CDP operations when native is absent",
    run: async () => {
      const sendUserOperation = async () => ({ userOperationHash: `0x${"ab".repeat(32)}` as `0x${string}` });
      const sdk = composeSdkBoundaries(input({
        cdp: {
          isSignedIn: true,
          ownerKey: "cdp-owner",
          provisionalSession: cdpSession,
          sendUserOperation,
        },
      }));
      expect(sdk.authentication).toBe("cdp");
      expect(sdk.ownerKey).toBe("cdp-owner");
      expect(sdk.provisionalSession).toEqual(cdpSession);
      expect(await sdk.getAccessToken()).toBe("token");
      expect(sdk.sendUserOperation).toBe(sendUserOperation);
    },
  },
  {
    name: "clears native only after CDP verification resolves",
    run: async () => {
      const verification = deferred();
      const events: string[] = [];
      const sdk = composeSdkBoundaries(input({
        cdp: { verifyEmailOTP: async () => { events.push("verify"); await verification.promise; } },
        identity: nativeSession,
        clearNative: async () => { events.push("clear-native"); },
      }));
      const result = sdk.verifyEmailOTP("flow", "123456");
      await Promise.resolve();
      expect(events).toEqual(["verify"]);
      verification.resolve();
      await result;
      expect(events).toEqual(["verify", "clear-native"]);
    },
  },
  {
    name: "does not clear native after CDP verification when native is absent",
    run: async () => {
      const events: string[] = [];
      const sdk = composeSdkBoundaries(input({
        cdp: { verifyEmailOTP: async () => { events.push("verify"); } },
        clearNative: async () => { events.push("clear-native"); },
      }));
      await sdk.verifyEmailOTP("flow", "123456");
      expect(events).toEqual(["verify"]);
    },
  },
  {
    name: "native verification remains a pure delegated action",
    run: async () => {
      const events: string[] = [];
      const sdk = composeSdkBoundaries(input({
        native: { verifyBaseAccountProof: async () => { events.push("verify"); } },
        cdpSignOut: async () => { events.push("sign-out-cdp"); },
      }));
      await sdk.verifyBaseAccountProof({ address: NATIVE_ADDRESS, message: "message", signature: "0x1234" });
      await Promise.resolve();
      expect(events).toEqual(["verify"]);
    },
  },
  {
    name: "keeps a healthy CDP owner exported while gating readiness during later native restores",
    run: async () => {
      const retrying = composeSdkBoundaries(input({
        cdp: { isSignedIn: true, ownerKey: "cdp-owner", provisionalSession: cdpSession },
        isSettled: false,
        hasSettled: true,
      }));
      expect({
        isInitialized: retrying.isInitialized,
        isSignedIn: retrying.isSignedIn,
        ownerKey: retrying.ownerKey,
        provisionalSession: retrying.provisionalSession,
      }).toEqual({
        isInitialized: false,
        isSignedIn: true,
        ownerKey: "cdp-owner",
        provisionalSession: cdpSession,
      });
    },
  },
  {
    name: "stays restoring through a controlled native retry and recovers with native precedence",
    run: async () => {
      const nativeRetry = deferred();
      let identity: VerifiedAccountSession | null = null;
      let isSettled = true;
      let initializationError: "provider-unavailable" | undefined = "provider-unavailable";
      let cdpSignedIn = false;
      const restore = async () => {
        isSettled = false;
        initializationError = undefined;
        await nativeRetry.promise;
        identity = nativeSession;
        isSettled = true;
      };
      const compose = () => composeSdkBoundaries(input({
        cdp: {
          isSignedIn: cdpSignedIn,
          ownerKey: cdpSignedIn ? "cdp-owner" : null,
          provisionalSession: cdpSignedIn ? cdpSession : null,
        },
        identity,
        isSettled,
        hasSettled: true,
        initializationError,
        restore,
      }));

      const failed = compose();
      expect(failed.isInitialized).toBe(true);
      expect(failed.initializationError).toBe("provider-unavailable");

      const retry = failed.retryInitialization?.();
      await Promise.resolve();
      const restoring = compose();
      expect({
        isInitialized: restoring.isInitialized,
        isSignedIn: restoring.isSignedIn,
        initializationError: restoring.initializationError,
      }).toEqual({
        isInitialized: false,
        isSignedIn: false,
        initializationError: undefined,
      });

      cdpSignedIn = true;
      nativeRetry.resolve();
      await retry;
      const recovered = compose();
      expect({
        authentication: recovered.authentication,
        isInitialized: recovered.isInitialized,
        isSignedIn: recovered.isSignedIn,
        ownerKey: recovered.ownerKey,
        provisionalSession: recovered.provisionalSession,
      }).toEqual({
        authentication: "native-base",
        isInitialized: true,
        isSignedIn: true,
        ownerKey: "native-owner",
        provisionalSession: nativeSession,
      });
    },
  },
  {
    name: "keeps email viable only while CDP initialization is pending",
    run: async () => {
      let nativeRestores = 0;
      const restore = async () => { nativeRestores += 1; };
      const cdpPending = composeSdkBoundaries(input({
        cdp: { isInitialized: false },
        initializationError: "provider-unavailable",
        restore,
      }));
      const cdpReadySignedOut = composeSdkBoundaries(input({
        initializationError: "provider-unavailable",
        restore,
      }));
      const cdpReadySignedIn = composeSdkBoundaries(input({
        cdp: { isSignedIn: true, ownerKey: "cdp-owner" },
        initializationError: "provider-unavailable",
        restore,
      }));
      expect(cdpPending.isInitialized).toBe(true);
      expect(cdpPending.initializationError).toBeUndefined();
      expect(cdpPending.retryInitialization).toBeUndefined();
      expect(cdpReadySignedOut.initializationError).toBe("provider-unavailable");
      await cdpReadySignedOut.retryInitialization?.();
      expect(nativeRestores).toBe(1);
      expect(cdpReadySignedIn.initializationError).toBeUndefined();
      expect(cdpReadySignedIn.retryInitialization).toBeUndefined();
    },
  },
  {
    name: "fails closed for a captured Base hint when native restoration fails",
    run: async () => {
      let nativeRestores = 0;
      const unavailable = composeSdkBoundaries(input({
        waitForBaseRestore: true,
        cdp: { isInitialized: false },
        initializationError: "provider-unavailable",
        restore: async () => { nativeRestores += 1; },
      }));

      expect(unavailable.isInitialized).toBe(true);
      expect(unavailable.isSignedIn).toBe(false);
      expect(unavailable.initializationError).toBe("provider-unavailable");
      await unavailable.retryInitialization?.();
      expect(nativeRestores).toBe(1);
    },
  },
  {
    name: "fails open for an anonymous native error without a restore hint",
    run: async () => {
      const anonymous = composeSdkBoundaries(input({
        cdp: { isInitialized: false },
        initializationError: "provider-unavailable",
      }));

      expect(anonymous.isInitialized).toBe(true);
      expect(anonymous.isSignedIn).toBe(false);
      expect(anonymous.initializationError).toBeUndefined();
      expect(anonymous.retryInitialization).toBeUndefined();
    },
  },
  {
    name: "fails closed when a hinted CDP restore fails after native settles signed out",
    run: async () => {
      let nativeRestores = 0;
      let cdpRetries = 0;
      const unavailable = composeSdkBoundaries(input({
        waitForCdpRestore: true,
        cdp: { isInitialized: false, initializationError: "provider-unavailable" },
        restore: async () => { nativeRestores += 1; },
        retryCdp: async () => { cdpRetries += 1; },
      }));

      expect(unavailable.isInitialized).toBe(true);
      expect(unavailable.isSignedIn).toBe(false);
      expect(unavailable.initializationError).toBe("provider-unavailable");
      await unavailable.retryInitialization?.();
      expect(nativeRestores).toBe(0);
      expect(cdpRetries).toBe(1);
    },
  },
  {
    name: "retries failed native and CDP initialization concurrently",
    run: async () => {
      const native = deferred();
      const cdp = deferred();
      const events: string[] = [];
      const unavailable = composeSdkBoundaries(input({
        waitForCdpRestore: true,
        cdp: { isInitialized: false, initializationError: "provider-unavailable" },
        initializationError: "provider-unavailable",
        restore: async () => { events.push("native"); await native.promise; },
        retryCdp: async () => { events.push("cdp"); await cdp.promise; },
      }));
      expect(unavailable.isInitialized).toBe(true);
      expect(unavailable.initializationError).toBe("provider-unavailable");

      const retry = unavailable.retryInitialization?.();
      await Promise.resolve();
      expect(events).toEqual(["native", "cdp"]);
      native.resolve();
      cdp.resolve();
      await retry;
    },
  },
  {
    name: "starts native and known-CDP cleanup concurrently",
    run: async () => {
      const native = deferred();
      const cdp = deferred();
      const events: string[] = [];
      const sdk = composeSdkBoundaries(input({
        clearNative: async () => { events.push("native"); await native.promise; },
        cdpSignOut: async () => { events.push("cdp"); await cdp.promise; },
      }));
      const cleanup = sdk.signOut();
      await Promise.resolve();
      expect(events).toEqual(["native", "cdp"]);
      native.resolve();
      cdp.resolve();
      await cleanup;
    },
  },
  {
    name: "skips an unauthenticated CDP sign-out when no cleanup evidence exists",
    run: async () => {
      let cdpCalls = 0;
      const sdk = composeSdkBoundaries(input({
        shouldSignOutCdp: () => false,
        cdpSignOut: async () => {
          cdpCalls += 1;
          throw new Error("User is not authenticated.");
        },
      }));
      await expect(sdk.signOut()).resolves.toBeUndefined();
      expect(cdpCalls).toBe(0);
    },
  },
  {
    name: "times out known-CDP cleanup, ignores its late phase, and allows a later retry",
    run: async () => {
      let cdpCalls = 0;
      const first = deferred();
      let firstAttempt: Promise<void> | null = null;
      const phases: string[] = [];
      const sdk = composeSdkBoundaries(input({
        cdpSignOut: async (onPhase) => {
          cdpCalls += 1;
          if (cdpCalls === 1) {
            firstAttempt = (async () => {
              await first.promise;
              onPhase?.({ phase: "cdp-signout", outcome: "success", durationMs: 3_000 });
            })();
            await firstAttempt;
          }
        },
      }));
      await expect(sdk.signOut((phase) => phases.push(`${phase.phase}:${phase.outcome}`)))
        .rejects.toThrow("timed out");
      expect(phases).toEqual(["cdp-signout:timeout"]);

      first.resolve();
      await firstAttempt;
      expect(phases).toEqual(["cdp-signout:timeout"]);
      await expect(sdk.signOut()).resolves.toBeUndefined();
      expect(cdpCalls).toBe(2);
    },
  },
  {
    name: "attempts both sign-outs in native-first order and rethrows a failure",
    run: async () => {
      const events: string[] = [];
      const sdk = composeSdkBoundaries(input({
        clearNative: async () => { events.push("native"); throw new Error("native failed"); },
        cdpSignOut: async () => { events.push("cdp"); },
      }));
      await expect(sdk.signOut()).rejects.toThrow("native failed");
      expect(events).toEqual(["native", "cdp"]);
    },
  },
];

describe("composite SDK boundary", () => {
  test("implements the settled provider and transition matrix", async () => {
    for (const row of rows) {
      try {
        await row.run();
      } catch (error) {
        throw new Error(`Composite boundary row failed: ${row.name}`, { cause: error });
      }
    }
  });
});
