import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import {
  ACCOUNT_PROVIDER_HINT_KEY,
  CDP_RESTORE_MARKER_KEY,
  clearCdpRenderHint,
  hasAccountProviderHint,
  hasCdpRestoreHint,
  hasCdpRestoreMarker,
  readAccountProviderHint,
  readHomeAuthRestoreHint,
  writeCdpRestoreMarker,
} from "./cdp-wallet-provider-capabilities";

const LIVE_NONCE = "a".repeat(48);

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.cookie = "home-cdp-live=; Max-Age=0; Path=/";
  document.cookie = "home-cdp-live-malformed=; Max-Age=0; Path=/";
});

function withCookieHeader(value: string, assertion: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(document, "cookie");
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => value,
    set: () => {},
  });
  try {
    assertion();
  } finally {
    if (descriptor) Object.defineProperty(document, "cookie", descriptor);
    else Reflect.deleteProperty(document, "cookie");
  }
}

describe("account provider restore hints", () => {
  test("reads only the closed sessionStorage hint values", () => {
    for (const hint of [
      "cdp-embedded",
      "pending:cdp-embedded",
      "base-account",
      "pending:base-account",
    ] as const) {
      window.sessionStorage.setItem(ACCOUNT_PROVIDER_HINT_KEY, hint);
      expect(readAccountProviderHint()).toBe(hint);
      expect(hasAccountProviderHint()).toBe(true);
      expect(readHomeAuthRestoreHint()).toBe(
        hint === "cdp-embedded" || hint === "pending:cdp-embedded" ? "cdp" : "base",
      );
    }

    window.sessionStorage.setItem(ACCOUNT_PROVIDER_HINT_KEY, "cdp-embedded:owner-secret");
    expect(readAccountProviderHint()).toBeNull();
    expect(hasAccountProviderHint()).toBe(false);
    window.sessionStorage.removeItem(ACCOUNT_PROVIDER_HINT_KEY);
    expect(readAccountProviderHint()).toBeNull();
  });

  test("waits only for CDP storage hints or an exact readable live nonce", () => {
    for (const hint of ["cdp-embedded", "pending:cdp-embedded"] as const) {
      window.sessionStorage.setItem(ACCOUNT_PROVIDER_HINT_KEY, hint);
      expect(hasCdpRestoreHint()).toBe(true);
    }
    for (const hint of ["base-account", "pending:base-account"] as const) {
      window.sessionStorage.setItem(ACCOUNT_PROVIDER_HINT_KEY, hint);
      expect(hasCdpRestoreHint()).toBe(false);
    }

    window.sessionStorage.clear();
    document.cookie = `home-cdp-live=${LIVE_NONCE}; Path=/`;
    expect(hasCdpRestoreHint()).toBe(true);
    expect(hasAccountProviderHint()).toBe(true);
    expect(readHomeAuthRestoreHint()).toBe("cdp");
  });

  test("rejects malformed, empty, differently named, and duplicate live cookies", () => {
    for (const cookieHeader of [
      "",
      "home-cdp-live=",
      "home-cdp-live=abc",
      `home-cdp-live=${"A".repeat(48)}`,
      `home-cdp-live=${"a".repeat(47)}`,
      `home-cdp-live=${"a".repeat(49)}`,
      `home-cdp-live-malformed=${LIVE_NONCE}`,
      `home-cdp-live=${LIVE_NONCE}; home-cdp-live=${"b".repeat(48)}`,
    ]) {
      withCookieHeader(cookieHeader, () => {
        expect(hasCdpRestoreHint()).toBe(false);
        expect(hasAccountProviderHint()).toBe(false);
      });
    }
  });

  test("persists a cross-tab CDP marker and clears it with private hints", () => {
    writeCdpRestoreMarker();
    expect(window.localStorage.getItem(CDP_RESTORE_MARKER_KEY)).toBe("1");
    expect(hasCdpRestoreMarker()).toBe(true);

    window.sessionStorage.clear();
    expect(hasCdpRestoreHint()).toBe(true);
    expect(hasAccountProviderHint()).toBe(true);
    expect(readHomeAuthRestoreHint()).toBe("cdp");

    clearCdpRenderHint();
    expect(window.localStorage.getItem(CDP_RESTORE_MARKER_KEY)).toBeNull();
    expect(hasCdpRestoreMarker()).toBe(false);
    expect(hasCdpRestoreHint()).toBe(false);
    expect(readHomeAuthRestoreHint()).toBe("none");
  });

  test("fails open for readiness when browser storage is unavailable", () => {
    const sessionDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    const localDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperties(window, {
      sessionStorage: {
        configurable: true,
        get() { throw new Error("storage blocked"); },
      },
      localStorage: {
        configurable: true,
        get() { throw new Error("storage blocked"); },
      },
    });
    try {
      expect(readAccountProviderHint()).toBeNull();
      expect(hasCdpRestoreMarker()).toBe(false);
      expect(hasCdpRestoreHint()).toBe(false);
    } finally {
      if (sessionDescriptor) Object.defineProperty(window, "sessionStorage", sessionDescriptor);
      if (localDescriptor) Object.defineProperty(window, "localStorage", localDescriptor);
    }
  });
});
