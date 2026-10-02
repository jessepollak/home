import "server-only";

import { requestOrigin } from "@/server/auth/signed-cookie";

export async function readSameOriginJson(request: Request): Promise<{ value: unknown } | { error: "CROSS_ORIGIN" | "INVALID_REQUEST" }> {
  const expected = requestOrigin(request);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!expected || !origin || origin !== expected.origin || (site !== null && site !== "same-origin")) return { error: "CROSS_ORIGIN" };
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return { error: "INVALID_REQUEST" };
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16_384)) return { error: "INVALID_REQUEST" };
  let text = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) return { error: "INVALID_REQUEST" };
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); return { error: "INVALID_REQUEST" }; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { value: JSON.parse(text) as unknown };
  } catch { return { error: "INVALID_REQUEST" }; }
}
