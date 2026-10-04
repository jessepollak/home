import { expect, mock, test } from "bun:test";

const actualReporter = { ...await import("@/client/observability/client-reporter") };

test("a throwing optional client reporter does not reject the hydration entrypoint import", async () => {
  let installs = 0;
  await mock.module("@/client/observability/client-reporter", () => ({
    ...actualReporter,
    installClientErrorReporting: () => { installs += 1; throw new Error("reporter unavailable"); },
  }));
  try {
    await expect(import("./instrumentation-client")).resolves.toBeDefined();
    expect(installs).toBe(1);
  } finally {
    await mock.module("@/client/observability/client-reporter", () => actualReporter);
  }
});
