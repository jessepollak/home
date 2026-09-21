import { installClientErrorReporting } from "@/client/observability/client-reporter";

try {
  installClientErrorReporting();
} catch { // oxlint-disable-line home/no-silent-catch -- optional client telemetry cannot delay or prevent hydration
  // Client observability cannot delay or prevent hydration.
}
