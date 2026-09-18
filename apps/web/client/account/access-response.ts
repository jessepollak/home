import { accessErrorCode, parseSafeAccessDestination } from "@/shared/access/contract";

export type AccessNavigation = {
  currentPath?: string;
  navigate?: (destination: string) => void;
};

const pendingInjectedNavigations = new WeakMap<(destination: string) => void, string>();
let pendingBrowserDestination: string | null = null;

function browserPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export async function redirectOnAccessRequired(
  response: Response,
  navigation: AccessNavigation = {},
): Promise<boolean> {
  if (response.status !== 401) return false;
  const payload = await response.clone().json().catch(() => null);
  if (accessErrorCode(payload) !== "ACCESS_REQUIRED") return false;

  const browserCurrent = navigation.currentPath ?? browserPath();
  let pathname: string;
  try {
    pathname = new URL(browserCurrent, "https://home.invalid").pathname;
  } catch {
    pathname = "/";
  }
  // The access surface is public and deliberately has no Home account
  // lifecycle. If an obsolete client still makes a protected request there,
  // consume the denial without replacing the original `next` destination.
  if (pathname === "/access" || pathname.startsWith("/access/")) return true;

  const current = parseSafeAccessDestination(browserCurrent);
  const query = new URLSearchParams({ next: current });
  const destination = `/access?${query.toString()}`;
  if (navigation.navigate) {
    if (pendingInjectedNavigations.get(navigation.navigate) === destination) return true;
    pendingInjectedNavigations.set(navigation.navigate, destination);
    navigation.navigate(destination);
  } else if (typeof window !== "undefined") {
    if (pendingBrowserDestination === destination) return true;
    pendingBrowserDestination = destination;
    // Access expiry crosses the proxy boundary and must replace client state with
    // a full document request rather than becoming an in-app auth transition.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(destination);
  }
  return true;
}
