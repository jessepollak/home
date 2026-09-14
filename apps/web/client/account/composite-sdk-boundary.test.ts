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
  cdp?: Partial<AccountWalletSdkBoundary>;
  identity?: VerifiedAccountSession | null;
  native?: Partial<AccountWalletSdkBoundary>;
  isSettled?: boolean;
  hasSettled?: boolean;
  initializationError?: "provider-unavailable";
  restore?: () => Promise<void>;
  clearNative?: () => Promise<void>;
  cdpSignOut?: () => Promise<void>;
} = {}): CompositeSdkBoundaryInput {
  const identity = overrides.identity ?? null;
  const isSettled = overrides.isSettled ?? true;
  return {
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
    name: "exports no identity until both providers settle",
    run: async () => {
      for (const unsettled of [
        input({ cdp: { isInitialized: false, isSignedIn: true, ownerKey: "cdp-owner", provisionalSession: cdpSession }, identity: nativeSession }),
        input({ cdp: { isSignedIn: true, ownerKey: "cdp-owner", provisionalSession: cdpSession }, identity: nativeSession, isSettled: false, hasSettled: false }),
      ]) {
        const sdk = composeSdkBoundaries(unsettled);
        expect({
          authentication: sdk.authentication,
          isInitialized: sdk.isInitialized,
          isSignedIn: sdk.isSignedIn,
          ownerKey: sdk.ownerKey,
          provisionalSession: sdk.provisionalSession,
        }).toEqual({
          authentication: "cdp",
          isInitialized: false,
          isSignedIn: false,
          ownerKey: null,
          provisionalSession: null,
        });
      }
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
    name: "keeps a healthy CDP owner exported during later native restores",
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
        isInitialized: true,
        isSignedIn: true,
        ownerKey: "cdp-owner",
        provisionalSession: cdpSession,
      });
    },
  },
  {
    name: "exports native retry only for a native initialization failure",
    run: async () => {
      const restore = async () => {};
      expect(composeSdkBoundaries(input({ restore })).retryInitialization).toBeUndefined();
      expect(composeSdkBoundaries(input({
        initializationError: "provider-unavailable",
        restore,
      })).retryInitialization).toBe(restore);
      expect(composeSdkBoundaries(input({
        cdp: { isSignedIn: true, ownerKey: "cdp-owner" },
        initializationError: "provider-unavailable",
        restore,
      })).retryInitialization).toBeUndefined();
    },
  },
  {
    name: "suppresses native initialization failure for a healthy CDP identity",
    run: async () => {
      const healthy = composeSdkBoundaries(input({
        cdp: { isSignedIn: true, ownerKey: "cdp-owner" },
        initializationError: "provider-unavailable",
      }));
      const signedOut = composeSdkBoundaries(input({ initializationError: "provider-unavailable" }));
      expect(healthy.initializationError).toBeUndefined();
      expect(signedOut.initializationError).toBe("provider-unavailable");
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
