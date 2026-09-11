import { installClientErrorReporting } from "@/client/observability/client-reporter";

try {
  installClientErrorReporting();
} catch {
  // Client observability cannot delay or prevent hydration.
}
