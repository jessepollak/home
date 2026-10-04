import { expect, mock, test } from "bun:test";

const actualOtel = { ...await import("@vercel/otel") };
const actualRequestReporter = { ...await import("@/server/observability/on-request-error") };
const { register, onRequestError } = await import("./instrumentation");

test("a throwing optional OTel registration does not reject server startup", async () => {
  const runtime = process.env.NEXT_RUNTIME;
  let registrations = 0;
  process.env.NEXT_RUNTIME = "nodejs";
  await mock.module("@vercel/otel", () => ({
    ...actualOtel,
    registerOTel: () => { registrations += 1; throw new Error("OTel unavailable"); },
  }));
  try {
    await expect(register()).resolves.toBeUndefined();
    expect(registrations).toBe(1);
  } finally {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = runtime;
    await mock.module("@vercel/otel", () => actualOtel);
  }
});

test("a throwing request reporter does not replace Next's original application error", async () => {
  const runtime = process.env.NEXT_RUNTIME;
  const original = new Error("application failed");
  const received: unknown[] = [];
  process.env.NEXT_RUNTIME = "nodejs";
  await mock.module("@/server/observability/on-request-error", () => ({
    ...actualRequestReporter,
    handleRequestError: (error: unknown) => { received.push(error); throw new Error("reporter unavailable"); },
  }));
  try {
    await expect(onRequestError(original, { path: "/home", method: "GET", headers: {} }, {
      routerKind: "App Router", routePath: "/home", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined,
    })).resolves.toBeUndefined();
    expect(received).toEqual([original]);
  } finally {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = runtime;
    await mock.module("@/server/observability/on-request-error", () => actualRequestReporter);
  }
});
