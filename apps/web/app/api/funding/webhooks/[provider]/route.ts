import { fundingJson } from "@/server/funding/core/auth";
import { getFundingCore } from "@/server/funding/core/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 65_536) return fundingJson({ accepted: true }, 202);
  let raw: Uint8Array;
  try { raw = new Uint8Array(await request.arrayBuffer()); } catch { return fundingJson({ accepted: true }, 202); }
  if (raw.byteLength > 65_536) return fundingJson({ accepted: true }, 202);
  const { provider } = await context.params;
  try { return fundingJson(await getFundingCore().handleWebhook(provider, raw, request.headers), 202); }
  catch { return fundingJson({ accepted: true }, 202); }
}
