import type { QueryClient } from "@tanstack/react-query";
import { clearOwnerQueryMemory } from "@/client/query/query-client";
import { clearIndexedOwnerCache } from "@/client/query/indexed-owner-cache";
import { clearHomeSummaryCookie } from "@/client/query/home-summary-cookie";

export type DeviceDeletionRow = { name: string; cleared: boolean };

export async function clearAccountDeletionDevice(queryClient: QueryClient, isCurrent: () => boolean): Promise<DeviceDeletionRow[]> {
  if (!isCurrent()) return [];
  let storageCleared = false;
  let boundaryCleared = false;
  try {
    clearOwnerQueryMemory(queryClient);
    boundaryCleared = true;
  } catch {
    queryClient.clear();
  }
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("home.") || key?.startsWith("home:")) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    storageCleared = true;
  } catch {
    storageCleared = false;
  }
  const cookieCleared = isCurrent() && clearHomeSummaryCookie();
  const indexedCleared = typeof indexedDB === "undefined" || await new Promise<boolean>((resolve) => {
    let finished = false;
    const finish = (cleared: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      resolve(cleared);
    };
    const deadline = setTimeout(() => finish(false), 1_500);
    void clearIndexedOwnerCache(undefined, undefined, () => !finished && isCurrent())
      .then(finish, () => finish(false));
  });
  return [
    { name: "Query cache", cleared: boundaryCleared },
    { name: "IndexedDB owner cache", cleared: indexedCleared },
    { name: "Restored query cache", cleared: storageCleared && boundaryCleared },
    { name: "Home summary cookie", cleared: cookieCleared },
    { name: "Device preferences and Home storage", cleared: storageCleared },
  ];
}
