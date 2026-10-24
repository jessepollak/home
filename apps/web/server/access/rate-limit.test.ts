import { describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import {
  isAccessLoginRateLimited,
  type AccessRateLimitDependencies,
} from "./rate-limit";

const deployment: AccessRateLimitDependencies = {
  environment: () => ({ VERCEL: "1" }),
};

function request() {
  return new Request("https://home.test/api/access", {
    headers: {
      host: "home.test",
      cookie: "home-access=probe; home-session=probe",
      authorization: "Bearer probe",
      "x-real-ip": "192.0.2.1",
    },
  });
}

describe("access login rate limit", () => {
  test("allows submissions and reports an unavailable check", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    try {
      const limited = await isAccessLoginRateLimited(request(), {
        ...deployment,
        check: async () => {
          const error = new Error("unavailable");
          error.name = "RateLimitProbeError";
          throw error;
        },
      });
      expect(limited).toBe(false);
      expect(lines.some((line) => line.includes("RATE_LIMIT_UNAVAILABLE"))).toBe(true);
      expect(lines.some((line) => line.includes('"errorName":"RateLimitProbeError"'))).toBe(true);
    } finally {
      setObservabilityLogWriterForTests();
    }
  });

  test("forwards only routing headers to the firewall", async () => {
    let captured: unknown;
    await isAccessLoginRateLimited(request(), {
      ...deployment,
      check: async (_id, options) => {
        captured = options?.headers;
        return { rateLimited: false };
      },
    });
    if (!(captured instanceof Headers)) throw new Error("headers were not forwarded as a Headers instance");
    expect(captured.get("cookie")).toBeNull();
    expect(captured.get("authorization")).toBeNull();
    expect(captured.get("x-real-ip")).toBe("192.0.2.1");
    expect(captured.get("host")).toBe("home.test");
  });

  test("rejects a rate-limited submission", async () => {
    expect(await isAccessLoginRateLimited(request(), {
      ...deployment,
      check: async () => ({ rateLimited: true }),
    })).toBe(true);
  });

  test("allows submissions and reports an unconfigured rule", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    try {
      const limited = await isAccessLoginRateLimited(request(), {
        ...deployment,
        check: async () => ({ rateLimited: false, error: "not-found" }),
      });
      expect(limited).toBe(false);
      expect(lines.some((line) => line.includes("RATE_LIMIT_NOT_CONFIGURED"))).toBe(true);
    } finally {
      setObservabilityLogWriterForTests();
    }
  });

  test("skips the check outside a Vercel deployment", async () => {
    let invoked = false;
    const limited = await isAccessLoginRateLimited(request(), {
      environment: () => ({}),
      check: async () => {
        invoked = true;
        return { rateLimited: true };
      },
    });
    expect(limited).toBe(false);
    expect(invoked).toBe(false);
  });
});
