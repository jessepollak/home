import "server-only";

type RequestBytesResult =
  | { kind: "ok"; bytes: Uint8Array }
  | { kind: "empty" }
  | { kind: "oversized" }
  | { kind: "invalid" }
  | { kind: "aborted" };

type RequestTextResult =
  | { kind: "ok"; text: string }
  | { kind: "empty" }
  | { kind: "oversized" }
  | { kind: "invalid" }
  | { kind: "aborted" };

type JsonBodyResult =
  | { kind: "ok"; value: unknown }
  | { kind: "empty" }
  | { kind: "oversized" }
  | { kind: "malformed" }
  | { kind: "aborted" }
  | { kind: "wrong-content-type" };

function cancelBody(request: Request): void {
  void request.body?.cancel().catch(() => undefined);
}

export async function readBoundedRequestBytes(
  request: Request,
  options: { maxBytes: number; timeoutMs?: number; ignoreContentLength?: boolean },
): Promise<RequestBytesResult> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let succeeded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    if (request.signal.aborted) return { kind: "aborted" };
    const length = options.ignoreContentLength ? null : request.headers.get("content-length");
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0 || (length !== null && !/^\d+$/.test(length))) return { kind: "invalid" };
    if (length !== null && Number(length) > options.maxBytes) return { kind: "oversized" };
    if (!request.body) { succeeded = true; return { kind: "empty" }; }
    reader = request.body.getReader();
    const aborted = new Promise<{ kind: "aborted" }>((resolve) => {
      abort = () => resolve({ kind: "aborted" });
      request.signal.addEventListener("abort", abort, { once: true });
      if (options.timeoutMs !== undefined) timer = setTimeout(abort, options.timeoutMs);
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await Promise.race([reader.read(), aborted]);
      if (request.signal.aborted || "kind" in result) return { kind: "aborted" };
      if (result.done) break;
      size += result.value.byteLength;
      if (size > options.maxBytes) return { kind: "oversized" };
      if (result.value.byteLength > 0) chunks.push(result.value);
    }
    if (size === 0) { succeeded = true; return { kind: "empty" }; }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    succeeded = true;
    return { kind: "ok", bytes };
  } catch {
    return { kind: request.signal.aborted ? "aborted" : "invalid" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) request.signal.removeEventListener("abort", abort);
    if (!succeeded) {
      if (reader) void reader.cancel().catch(() => undefined);
      else cancelBody(request);
    }
    reader?.releaseLock();
  }
}

export async function readBoundedRequestText(
  request: Request,
  options: { maxBytes: number; timeoutMs?: number; ignoreContentLength?: boolean; fatal?: boolean },
): Promise<RequestTextResult> {
  const result = await readBoundedRequestBytes(request, options);
  if (result.kind !== "ok") return result;
  try {
    return { kind: "ok", text: new TextDecoder("utf-8", { fatal: options.fatal ?? true }).decode(result.bytes) };
  } catch {
    cancelBody(request);
    return { kind: "invalid" };
  }
}

export async function readJsonBody(
  request: Request,
  options: { maxBytes: number; contentType?: string; timeoutMs?: number },
): Promise<JsonBodyResult> {
  if (options.contentType !== undefined && request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== options.contentType.toLowerCase()) {
    cancelBody(request);
    return { kind: "wrong-content-type" };
  }
  const result = await readBoundedRequestText(request, options);
  if (result.kind === "invalid") return { kind: "malformed" };
  if (result.kind !== "ok") return result;
  try {
    const value: unknown = JSON.parse(result.text);
    return { kind: "ok", value };
  } catch {
    cancelBody(request);
    return { kind: "malformed" };
  }
}
