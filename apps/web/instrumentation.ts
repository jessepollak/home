import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { registerOTel } = await import("@vercel/otel");
  registerOTel({ serviceName: "home-web" });
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { handleRequestError } = await import(
    "@/server/observability/on-request-error"
  );
  await handleRequestError(error, request, context);
};
