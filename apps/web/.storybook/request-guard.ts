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
  "/asset-marks/",
  "/network-marks/",
  "/home-mark/",
  "/client/",
  "/components/",
  "/config/",
  "/lib/",
  "/shared/",
  "/stories/",
  "/.storybook/",
] as const;

const STORYBOOK_RUNTIME_EXACT_PATHS = ["/vite-inject-mocker-entry.js"] as const;

export function isStorybookRuntimeRequest(request: Request, storybookOrigin: string): boolean {
  const url = new URL(request.url);
  if (url.origin !== storybookOrigin) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  return STORYBOOK_RUNTIME_EXACT_PATHS.some((path) => url.pathname === path) ||
    /^\/tests\/browser\/fixtures\/(?:[\w-]+\/)*[\w-]+\.(?:ts|tsx|js|mjs)$/.test(url.pathname) ||
    STORYBOOK_RUNTIME_PATHS.some((path) => url.pathname.startsWith(path));
}

const VERCEL_TOOLBAR_HOSTS = ["vercel.live", "vercel.com", "pusher.com"] as const;
const VERCEL_TOOLBAR_PATHS = ["/.well-known/vercel/", "/_vercel/"] as const;

export function isVercelToolbarRequest(request: Request, storybookOrigin: string): boolean {
  const url = new URL(request.url);
  if (url.origin === storybookOrigin) return VERCEL_TOOLBAR_PATHS.some((path) => url.pathname.startsWith(path));
  return url.protocol === "https:" &&
    VERCEL_TOOLBAR_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export function rejectUnexpectedStoryRequest(request: Request, storybookOrigin: string): void {
  if (isStorybookRuntimeRequest(request, storybookOrigin) || isVercelToolbarRequest(request, storybookOrigin)) return;

  throw new Error(
    `[Storybook request guard] Unexpected ${request.method} request to ${request.url}. `
      + "Add an explicit story handler or inject the component boundary instead of reaching a live origin.",
  );
}
