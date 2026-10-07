import { readAnonymousCountryPreference } from "@/config/country-preference";
import { showSmallBalancesPreferenceKey } from "@/client/home/use-show-small-balances";
import { ownerQueryStorageKey } from "@/client/query/query-client";
import { appearancePreferenceKey, parseAppearancePreference } from "@/shared/appearance/preference";
import { homeSummaryCookieName } from "@/shared/balances/home-summary";
import { isRecord } from "@/shared/guards";
import type { AccountExportFile, AccountExportResponse } from "@/shared/account/contracts/data-export";

function storedPreference<T>(key: string, parse: (value: string) => T): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? null : parse(value);
  } catch {
    return null;
  }
}

function restoredCachePresent(ownerKey: string): boolean | null {
  try {
    const key = ownerQueryStorageKey(ownerKey);
    return key !== null && window.localStorage.getItem(key) !== null;
  } catch {
    return null;
  }
}

function summaryCookiePresent(): boolean | null {
  try {
    return document.cookie.split(";").some((cookie) => cookie.trim().startsWith(`${homeSummaryCookieName}=`));
  } catch {
    return null;
  }
}

function indexedOwnerCachePresent(ownerKey: string, signal?: AbortSignal): Promise<boolean | null> {
  return new Promise((resolve) => {
    let finished = false;
    let database: IDBDatabase | undefined;
    const finish = (present: boolean | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      database?.close();
      resolve(present);
    };
    const abort = () => finish(null);
    const deadline = setTimeout(abort, 1500);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      finish(null);
      return;
    }
    const inspect = async () => {
      if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return null;
      const databases = await indexedDB.databases();
      if (finished) return null;
      if (!databases.some((database) => database.name === "home-query-cache")) return false;
      const connection = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("home-query-cache");
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onsuccess = () => {
          if (finished) request.result.close();
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Cache database unavailable"));
      });
      database = connection;
      if (finished) {
        connection.close();
        return null;
      }
      if (!connection.objectStoreNames.contains("owner-clients")) return false;
      const value: unknown = await new Promise((resolve, reject) => {
        const transaction = connection.transaction("owner-clients", "readonly");
        const request = transaction.objectStore("owner-clients").get("owner-client");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return isRecord(value) && value.owner === ownerKey && typeof value.value === "string";
    };
    void inspect().then(finish, () => finish(null));
  });
}

export async function buildAccountExportFile(response: AccountExportResponse, ownerKey: string, signal?: AbortSignal): Promise<AccountExportFile> {
  const indexedCachePresent = await indexedOwnerCachePresent(ownerKey, signal);
  return {
    ...response,
    classes: [
      ...response.classes,
      {
        name: "device_preferences",
        holder: "current-device",
        records: [{
          region: readAnonymousCountryPreference(() => window.localStorage).country,
          showSmallBalances: storedPreference(showSmallBalancesPreferenceKey, (value) => value === "true"),
          appearance: storedPreference(appearancePreferenceKey, parseAppearancePreference),
        }],
      },
      {
        name: "device_caches",
        holder: "current-device",
        records: [
          { kind: "indexed_owner_cache", present: indexedCachePresent, description: "Private query cache in IndexedDB; contents omitted." },
          { kind: "restored_query_cache", present: restoredCachePresent(ownerKey), description: "Private query cache in browser storage; contents omitted." },
          { kind: "home_summary_cookie", present: summaryCookiePresent(), description: "Home display summary cookie; contents omitted." },
        ],
      },
    ],
  };
}

export function downloadAccountExport(file: AccountExportFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = `home-data-export-${file.generatedAt.slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
