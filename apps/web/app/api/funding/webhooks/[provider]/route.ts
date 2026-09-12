import { fundingJson } from "@/server/funding/core/auth";
import { getFundingCore } from "@/server/funding/core/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 64 * 1024;
const WEBHOOK_READ_TIMEOUT_MS = 6_000;

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  const raw = await readBoundedWebhookBody(request);
  if (!raw) return fundingJson({ accepted: true }, 202);
  const { provider } = await context.params;
  try { return fundingJson(await getFundingCore().handleWebhook(provider, raw, request.headers), 202); }
  catch { return fundingJson({ accepted: true }, 202); }
}

export async function readBoundedWebhookBody(
  request: Request,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Uint8Array | null> {
  const maxBytes = options.maxBytes ?? MAX_WEBHOOK_BYTES;
  const timeoutMs = options.timeoutMs ?? WEBHOOK_READ_TIMEOUT_MS;
  const reader = request.body?.getReader();
  if (!reader || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("webhook-read-timeout")), timeoutMs);
    });
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(value);
    }
    const raw = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
    return raw;
  } catch { return null; }
  finally {
    if (timer) clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}
