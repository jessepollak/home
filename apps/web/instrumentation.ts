import type { Instrumentation } from "next";
import { handleRequestError } from "@/server/observability/on-request-error";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { registerOTel } = await import("@vercel/otel");
  registerOTel({ serviceName: "home-web" });
}

export const onRequestError: Instrumentation.onRequestError = handleRequestError;
