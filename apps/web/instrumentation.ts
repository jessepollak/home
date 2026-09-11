import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({
      serviceName: "home-web",
      // Source-level traces stay disabled until a processor can prove that
      // framework span names, attributes, events, and exceptions are scrubbed.
      instrumentations: [],
      traceSampler: "always_off",
    });
  } catch {
    // Instrumentation initialization cannot prevent the server from starting.
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { handleRequestError } = await import(
      "@/server/observability/on-request-error"
    );
    await handleRequestError(error, request, context);
  } catch {
    // Next remains the sole owner of the original application error.
  }
};
