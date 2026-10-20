import { readJson } from "@/shared/http/read-json";
import type { SessionFetch } from "./session-client";

export async function recoverAccountDeletionReceipt({ sessionFetch = fetch, headers, assertCurrent }: {
  sessionFetch?: SessionFetch;
  headers: HeadersInit | (() => Promise<HeadersInit>);
  assertCurrent: () => void;
}): Promise<unknown> {
  assertCurrent();
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const resolvedHeaders = typeof headers === "function" ? await headers() : headers;
        assertCurrent();
        if (controller.signal.aborted) throw new Error("Deletion receipt unavailable");
        const response = await sessionFetch("/api/account/deletion", {
          method: "GET", headers: resolvedHeaders, cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal,
        });
        assertCurrent();
        if (controller.signal.aborted) throw new Error("Deletion receipt unavailable");
        if (!response.ok) throw new Error("Deletion receipt unavailable");
        const receipt = await readJson(response);
        assertCurrent();
        if (controller.signal.aborted) throw new Error("Deletion receipt unavailable");
        return receipt;
      })(),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          controller.abort();
          reject(new Error("Deletion receipt unavailable"));
        }, 20_000);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}
