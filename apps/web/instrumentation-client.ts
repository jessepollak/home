import { installClientErrorReporting } from "@/features/observability/client-reporter";

try {
  installClientErrorReporting();
} catch {
  // Client observability cannot delay or prevent hydration.
}
