import { accessErrorCode, parseSafeAccessDestination } from "@/shared/access/contract";

export type AccessNavigation = {
  currentPath?: string;
  navigate?: (destination: string) => void;
};

type NavigationTarget = (destination: string) => void;

type NavigateOnceOptions = {
  target: object;
  destination: string;
  navigate: NavigationTarget;
  releaseAfterNavigation: boolean;
};

const pendingNavigations = new WeakMap<object, Map<string, Promise<void>>>();
const browserNavigationTarget = {};

async function navigateOnce({
  target,
  destination,
  navigate,
  releaseAfterNavigation,
}: NavigateOnceOptions): Promise<void> {
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
  if (pathname === "/access" || pathname.startsWith("/access/")) return true;

  const current = parseSafeAccessDestination(browserCurrent);
  const query = new URLSearchParams({ next: current });
  const destination = `/access?${query.toString()}`;
  if (navigation.navigate) {
    await navigateOnce({
      target: navigation.navigate,
      destination,
      navigate: navigation.navigate,
      releaseAfterNavigation: true,
    });
  } else if (typeof window !== "undefined") {
    await navigateOnce({
      target: browserNavigationTarget,
      destination,
      navigate: (value) => {
        window.location.assign(value);
      },
      releaseAfterNavigation: false,
    });
  }
  return true;
}
