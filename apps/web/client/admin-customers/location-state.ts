import { useEffect, useSyncExternalStore } from "react";
import { browserHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { OwnerQueryScope } from "@/client/query/query-scopes";
import type { CustomerReadFailure } from "./api";

const customerScopes: readonly OwnerQueryScope[] = ["admin-customer-search", "admin-customer-detail"];

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
  };
}

export function useLocationFragment(): string | null {
  return useSyncExternalStore(subscribe, () => window.location.hash.replace(/^#/, ""), () => null);
}

export function pushLocationFragment(path: string, fragment: string): void {
  window.history.pushState(null, "", fragment ? `${path}#${fragment}` : path);
  for (const listener of listeners) listener();
}

export function usePurgeCustomersOnAccessLoss(operator: string, failure: CustomerReadFailure | null): void {
  useEffect(() => {
    if (failure !== "signed-out" && failure !== "forbidden") return;
    const client = browserHomeQueryClient();
    for (const scope of customerScopes) client?.removeQueries({ queryKey: ownerQueryKey(operator, scope), type: "inactive" });
  }, [operator, failure]);
}

function subscribeVisibility(listener: () => void): () => void {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "visible", () => true);
}
