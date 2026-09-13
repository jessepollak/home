import { describe, expect, test } from "bun:test";
import {
  CLIENT_ERROR_MAX_REPORTS_PER_PAGE,
  createBoundedClientErrorReporter,
  reportClientError,
  type ClientErrorTransport,
} from "./client-reporter";

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

    expect(calls).toHaveLength(CLIENT_ERROR_MAX_REPORTS_PER_PAGE);
  });
});
