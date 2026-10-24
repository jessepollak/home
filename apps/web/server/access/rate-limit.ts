import "server-only";

import { checkRateLimit } from "@vercel/firewall";
import { serverEnvironment } from "@/server/config/env";
import { emitServerEvent } from "@/server/observability/log";

const ACCESS_LOGIN_RATE_LIMIT_ID = "home-access-login";
const ACCESS_LOGIN_RATE_LIMIT_TIMEOUT_MS = 1_000;

type RateLimitCheck = typeof checkRateLimit;

export type AccessRateLimitDependencies = {
  check?: RateLimitCheck;
  environment?: () => Readonly<Record<string, string | undefined>>;
};

function errorLabel(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const { name } = error;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return "Error";
}

export async function isAccessLoginRateLimited(
  request: Request,
  input: AccessRateLimitDependencies = {},
): Promise<boolean> {
  if ((input.environment ?? serverEnvironment)().VERCEL !== "1") return false;
  try {
    const headers = new Headers();
    for (const name of ["host", "x-real-ip", "x-forwarded-for"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const { rateLimited, error } = await (input.check ?? checkRateLimit)(
      ACCESS_LOGIN_RATE_LIMIT_ID,
      { headers, timeout: ACCESS_LOGIN_RATE_LIMIT_TIMEOUT_MS },
    );
    if (error === "not-found") {
      emitServerEvent("access-login", {
        route: "/api/access",
        code: "RATE_LIMIT_NOT_CONFIGURED",
        outcome: "skipped",
      });
      return false;
    }
    return rateLimited;
  } catch (error) {
    emitServerEvent("access-login", {
      route: "/api/access",
      code: "RATE_LIMIT_UNAVAILABLE",
      outcome: "unavailable",
      errorName: errorLabel(error),
    });
    return false;
  }
}
