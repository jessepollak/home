import { accessErrorCode, parseSafeAccessDestination } from "@/shared/access/contract";

export type AccessNavigation = {
  currentPath?: string;
  navigate?: (destination: string) => void;
};

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

  const current = parseSafeAccessDestination(navigation.currentPath ?? browserPath());
  const query = new URLSearchParams({ next: current });
  const destination = `/access?${query.toString()}`;
  if (navigation.navigate) navigation.navigate(destination);
  // Access expiry crosses the proxy boundary and must replace client state with
  // a full document request rather than becoming an in-app auth transition.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  else if (typeof window !== "undefined") window.location.assign(destination);
  return true;
}
