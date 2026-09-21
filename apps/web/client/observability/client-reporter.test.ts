import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import {
  CLIENT_ERROR_MAX_REPORTS_PER_PAGE,
  createBoundedClientErrorReporter,
  installClientErrorReporting,
  reportClientError,
  type ClientErrorTransport,
} from "./client-reporter";

afterEach(() => {
  window.__homeClientErrorReportingInstalled = false;
});

describe("client error reporter", () => {
  test("swallows synchronous throws and rejected transports", async () => {
    await expect(
      reportClientError(
        { name: "Error", message: "boom", route: "/" },
        (() => { throw new Error("sync failure"); }) as ClientErrorTransport,
      ),
    ).resolves.toBeUndefined();
    await expect(
      reportClientError(
        { name: "Error", message: "boom", route: "/" },
        async () => { throw new Error("async failure"); },
      ),
    ).resolves.toBeUndefined();
  });

  test("a throwing getter or proxy value is ignored", async () => {
    const calls: string[] = [];
    installClientErrorReporting(async (_input, init) => {
      calls.push(String(init.body));
      return { ok: true, status: 204 };
    });
    const hostile = Object.create(Error.prototype, {
      name: { get: () => { throw new Error("hostile name"); } },
      message: { get: () => { throw new Error("hostile message"); } },
    });

    window.dispatchEvent(new ErrorEvent("error", { error: hostile }));
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!)).toMatchObject({ name: "UnhandledRejection", message: "Non-Error rejection" });
  });

  test("installation failure does not block hydration", () => {
    const original = window.addEventListener;
    window.addEventListener = (() => { throw new Error("listener unavailable"); }) as typeof window.addEventListener;
    try {
      expect(() => installClientErrorReporting()).not.toThrow();
    } finally {
      window.addEventListener = original;
    }
  });

  test("bounds reports per page to prevent error loops", async () => {
    const calls: string[] = [];
    const report = createBoundedClientErrorReporter(async (_input, init) => {
      calls.push(String(init.body));
      return { ok: true, status: 204 };
    });

    for (let index = 0; index < CLIENT_ERROR_MAX_REPORTS_PER_PAGE + 3; index += 1) {
      report({ name: "Error", message: `failure ${index}`, route: "/" });
    }
    await Promise.resolve();

    expect(calls).toHaveLength(5);
  });
});
