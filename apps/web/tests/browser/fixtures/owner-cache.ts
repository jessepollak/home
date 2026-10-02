import type { Page } from "@playwright/test";

export async function readIndexedOwnerCache(page: Page): Promise<string | null> {
  return page.evaluate(() => new Promise<string | null>((resolve, reject) => {
    const open = indexedDB.open("home-query-cache");
    open.onupgradeneeded = () => { open.result.createObjectStore("owner-clients"); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction("owner-clients", "readonly");
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      const request = transaction.objectStore("owner-clients").get("owner-client");
      request.onsuccess = () => {
        const record: unknown = request.result;
        resolve(record && typeof record === "object" && "value" in record && typeof record.value === "string" ? record.value : null);
      };
    };
  }));
}

export async function replaceIndexedOwnerCache(page: Page, previous: string, value: string): Promise<void> {
  await page.evaluate(({ previous, value }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("home-query-cache");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction("owner-clients", "readwrite");
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error("Owner cache changed")); };
      const store = transaction.objectStore("owner-clients");
      const request = store.get("owner-client");
      request.onsuccess = () => {
        const record: unknown = request.result;
        if (!record || typeof record !== "object" || !("value" in record) || record.value !== previous) { transaction.abort(); return; }
        store.put({ ...record, value }, "owner-client");
      };
    };
  }), { previous, value });
}
