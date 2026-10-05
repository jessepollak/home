import "server-only";

import { requestOrigin } from "@/server/auth/signed-cookie";
import { readJsonBody } from "@/server/http/request";

export async function readSameOriginJson(request: Request): Promise<{ value: unknown } | { error: "CROSS_ORIGIN" | "INVALID_REQUEST" }> {
  const expected = requestOrigin(request);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!expected || !origin || origin !== expected.origin || (site !== null && site !== "same-origin")) return { error: "CROSS_ORIGIN" };
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return { error: "INVALID_REQUEST" };
  const result = await readJsonBody(request, { maxBytes: 16_384 });
  return result.kind === "ok" ? { value: result.value } : { error: "INVALID_REQUEST" };
}
