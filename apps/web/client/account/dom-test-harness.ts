import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";
import { notifyManager } from "@tanstack/react-query";
import { getHomeQueryClient } from "@/client/query/query-client";

if (typeof window === "undefined") {
  const serverFetchDescriptors = Object.fromEntries(
    ["AbortController", "AbortSignal", "Headers", "Request", "Response"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );

  GlobalRegistrator.register({
    url: "http://localhost:3111/",
    settings: {
      disableCSSFileLoading: true,
      enableImageFileLoading: false,
      disableJavaScriptFileLoading: true,
    },
  });

  for (const [name, descriptor] of Object.entries(serverFetchDescriptors)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  }

  globalThis.fetch = (async (input: RequestInfo | URL) =>
    new Response(null, {
      status: 503,
      statusText: `Unit tests cannot reach the network: ${String(input)}`,
    })) as unknown as typeof fetch;
}

notifyManager.setScheduler((callback) => queueMicrotask(callback));

const testingLibrary = await import("@testing-library/react");
const cleanupDomTests = testingLibrary.cleanup;
export const within = testingLibrary.within;

afterEach(() => {
  cleanupDomTests();
  getHomeQueryClient().clear();
});
