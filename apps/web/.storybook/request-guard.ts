const STORYBOOK_RUNTIME_PATHS = [
  "/@",
  "/assets/",
  "/node_modules/",
  "/sb-",
  "/iframe.html",
  "/index.json",
  "/project.json",
  "/favicon.svg",
  "/mockServiceWorker.js",
  "/currency-flags/",
  "/home-mark/",
] as const;

export function isStorybookRuntimeRequest(request: Request, storybookOrigin: string): boolean {
  const url = new URL(request.url);
  if (url.origin !== storybookOrigin) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  return STORYBOOK_RUNTIME_PATHS.some((path) => url.pathname.startsWith(path));
}

export function rejectUnexpectedStoryRequest(request: Request, storybookOrigin: string): void {
  if (isStorybookRuntimeRequest(request, storybookOrigin)) return;

  throw new Error(
    `[Storybook request guard] Unexpected ${request.method} request to ${request.url}. `
      + "Add an explicit story handler or inject the component boundary instead of reaching a live origin.",
  );
}
