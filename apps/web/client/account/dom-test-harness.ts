import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { getHomeQueryClient } from "@/client/query/query-client";
import { registerDomTestCleanup } from "@/tests/helpers/dom-test-cleanup";
import { guardAnimationCancellation } from "@/tests/helpers/animation-cancel-guard";

if (typeof window === "undefined") {
  const serverFetchDescriptors = Object.fromEntries(
    ["AbortController", "AbortSignal", "Headers", "Request", "Response", "ReadableStream", "WritableStream", "TransformStream", "TextDecoderStream", "TextEncoderStream"].map((name) => [
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
  (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;
  guardAnimationCancellation();

  for (const [name, descriptor] of Object.entries(serverFetchDescriptors)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  }

  globalThis.fetch = (async (input: RequestInfo | URL) =>
    new Response(null, {
      status: 503,
      statusText: `Unit tests cannot reach the network: ${String(input)}`,
    })) as unknown as typeof fetch;
}

const testingLibrary = await import("@testing-library/react");
const cleanupDomTests = testingLibrary.cleanup;
export const within = testingLibrary.within;

registerDomTestCleanup(() => {
  cleanupDomTests();
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
  getHomeQueryClient().clear();
});
