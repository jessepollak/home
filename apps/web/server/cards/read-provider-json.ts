import "server-only";

const MAX_RESPONSE_BYTES = 64 * 1024;

export async function readProviderJson(response: Response, provider: "Bridge" | "Stripe"): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Invalid ${provider} JSON`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error(`${provider} response too large`);
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString("utf8")) as unknown;
  } catch {
    throw new Error(`Invalid ${provider} JSON`);
  }
}
