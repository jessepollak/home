import { accessErrorCode, parseSafeAccessDestination } from "@/shared/access/contract";

export type AccessNavigation = {
  currentPath?: string;
  navigate?: (destination: string) => void;
};

type NavigationTarget = (destination: string) => void;

const pendingNavigations = new WeakMap<object, Map<string, Promise<void>>>();
const browserNavigationTarget = {};

async function navigateOnce(
  target: object,
  destination: string,
  navigate: NavigationTarget,
  releaseAfterNavigation: boolean,
): Promise<void> {
  let targetNavigations = pendingNavigations.get(target);
  if (!targetNavigations) {
    targetNavigations = new Map();
    pendingNavigations.set(target, targetNavigations);
  }

  const pending = targetNavigations.get(destination);
  if (pending) {
    await pending;
    return;
  }

  const navigation = Promise.resolve().then(() => navigate(destination));
  targetNavigations.set(destination, navigation);
  try {
    await navigation;
  } finally {
    if (releaseAfterNavigation && targetNavigations.get(destination) === navigation) {
      targetNavigations.delete(destination);
    }
  }
}

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
    // Injected navigation represents a soft lifecycle: concurrent denials share
    // one transition, then a later expiry may legitimately navigate again.
    await navigateOnce(navigation.navigate, destination, navigation.navigate, true);
  } else if (typeof window !== "undefined") {
    // Access expiry crosses the proxy boundary and must replace client state with
    // a full document request rather than becoming an in-app auth transition.
    // Keep that hard navigation one-shot because a successful assign unloads this
    // module; if it does not unload, repeated protected calls must not loop.
    await navigateOnce(browserNavigationTarget, destination, (value) => {
      window.location.assign(value);
    }, false);
  }
  return true;
}
