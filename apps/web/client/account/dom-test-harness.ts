import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof window === "undefined") {
  // Happy DOM models browser fetch responses, so it intentionally drops the
  // forbidden Set-Cookie response header. Keep Bun's server Fetch API globals
  // when installing the shared DOM to prevent UI tests from changing route
  // handler behavior later in the same test process.
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

  // Fail closed: no unit test may reach the network. Tests that need a
  // response stub `window.fetch` themselves.
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    new Response(null, {
      status: 503,
      statusText: `Unit tests cannot reach the network: ${String(input)}`,
    })) as unknown as typeof fetch;
}

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
}

if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
}
