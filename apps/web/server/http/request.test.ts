import { expect, mock, test } from "bun:test";
import { readBoundedRequestBytes, readBoundedRequestText, readJsonBody } from "./request";

function streamed(chunks: Uint8Array[], options: { headers?: HeadersInit; signal?: AbortSignal; close?: boolean; cancel?: () => void | Promise<void> } = {}): Request {
  return new Request("https://home.test", {
    method: "POST",
    headers: options.headers,
    signal: options.signal,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        if (options.close !== false) controller.close();
      },
      cancel: options.cancel,
    }),
  });
}

const encode = (text: string) => new TextEncoder().encode(text);

test.each(["invalid", "-1", "1.5", "1e2", "0x10"])("strictly rejects non-digit content-length %s by default", async (length) => {
  const request = streamed([encode("ab")], { headers: { "content-length": length } });
  expect(await readBoundedRequestBytes(request, { maxBytes: 4 })).toEqual({ kind: "invalid" });
  expect(request.body?.locked).toBe(false);
});

test.each(["invalid", "1.5", "100"])("ignores content-length %s only when requested while retaining the streamed bound", async (length) => {
  for (const maxBytes of [1, 2]) {
    const request = streamed([encode("ab")], { headers: { "content-length": length } });
    expect(await readBoundedRequestBytes(request, { maxBytes, ignoreContentLength: true })).toEqual(
      maxBytes === 2 ? { kind: "ok", bytes: encode("ab") } : { kind: "oversized" },
    );
    expect(request.body?.locked).toBe(false);
  }
});

test("reads split UTF-8 text at its byte limit", async () => {
  const bytes = encode("€");
  const request = streamed([bytes.slice(0, 1), bytes.slice(1)]);
  expect(await readBoundedRequestText(request, { maxBytes: 3 })).toEqual({ kind: "ok", text: "€" });
  expect(request.body?.locked).toBe(false);
});

test.each([undefined, true, false])("text decoding uses fatal UTF-8 unless explicitly disabled: %s", async (fatal) => {
  const request = streamed([new Uint8Array([0xff])]);
  expect(await readBoundedRequestText(request, { maxBytes: 3, fatal })).toEqual(
    fatal === false ? { kind: "ok", text: "�" } : { kind: "invalid" },
  );
  expect(request.body?.locked).toBe(false);
});

test("text reader preserves empty, oversized, invalid and aborted outcomes", async () => {
  expect(await readBoundedRequestText(new Request("https://home.test"), { maxBytes: 4 })).toEqual({ kind: "empty" });
  expect(await readBoundedRequestText(streamed([]), { maxBytes: 4 })).toEqual({ kind: "empty" });
  expect(await readBoundedRequestText(streamed([encode("abcde")]), { maxBytes: 4 })).toEqual({ kind: "oversized" });
  expect(await readBoundedRequestText(streamed([], { headers: { "content-length": "invalid" } }), { maxBytes: 4 })).toEqual({ kind: "invalid" });
  expect(await readBoundedRequestText(streamed([encode("abcd")], { headers: { "content-length": "invalid" } }), { maxBytes: 4, ignoreContentLength: true })).toEqual({ kind: "ok", text: "abcd" });
  const controller = new AbortController();
  const cancel = mock(() => {});
  const request = streamed([], { signal: controller.signal, close: false, cancel });
  const pending = readBoundedRequestText(request, { maxBytes: 4 });
  controller.abort();
  expect(await pending).toEqual({ kind: "aborted" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request.body?.locked).toBe(false);
});

test("reads bytes at the declared limit and releases the reader", async () => {
  const request = streamed([encode("ab"), encode("cd")]);
  expect(await readBoundedRequestBytes(request, { maxBytes: 4 })).toEqual({ kind: "ok", bytes: encode("abcd") });
  expect(request.body?.locked).toBe(false);
});

test("reads JSON as unknown and permits primitives", async () => {
  for (const value of [{ value: 1 }, null, 42, "text", true]) {
    const request = streamed([encode(JSON.stringify(value))]);
    expect(await readJsonBody(request, { maxBytes: 64 })).toEqual({ kind: "ok", value });
    expect(request.body?.locked).toBe(false);
  }
});

test("reports absent and zero-byte bodies as empty", async () => {
  for (const request of [new Request("https://home.test"), streamed([]), streamed([new Uint8Array()])]) {
    expect(await readJsonBody(request, { maxBytes: 64 })).toEqual({ kind: "empty" });
    expect(request.body?.locked ?? false).toBe(false);
  }
});

test.each(["content-length", "chunks"])("cancels oversized bodies detected via %s", async (mode) => {
  const cancel = mock(() => {});
  const request = streamed([encode("ab"), encode("cd")], {
    headers: mode === "content-length" ? { "content-length": "4" } : undefined,
    close: false,
    cancel,
  });
  expect(await readJsonBody(request, { maxBytes: 3 })).toEqual({ kind: "oversized" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request.body?.locked).toBe(false);
});

test("rejects invalid length without reading and cancels", async () => {
  const cancel = mock(() => {});
  const request = streamed([], { headers: { "content-length": "invalid" }, close: false, cancel });
  expect(await readBoundedRequestBytes(request, { maxBytes: 64 })).toEqual({ kind: "invalid" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request.body?.locked).toBe(false);
});

test.each([encode("{"), new Uint8Array([0x22, 0xff, 0x22])])("rejects malformed JSON and invalid UTF-8 without leaving a lock", async (bytes) => {
  const request = streamed([bytes]);
  expect(await readJsonBody(request, { maxBytes: 64 })).toEqual({ kind: "malformed" });
  expect(request.body?.locked).toBe(false);
});

test.each([null, "text/plain", "application/jsonp"])("rejects missing or wrong media type %s and cancels", async (contentType) => {
  const cancel = mock(() => {});
  const request = streamed([encode("{}")], {
    headers: contentType ? { "content-type": contentType } : undefined,
    close: false,
    cancel,
  });
  expect(await readJsonBody(request, { maxBytes: 64, contentType: "application/json" })).toEqual({ kind: "wrong-content-type" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request.body?.locked).toBe(false);
});

test.each(["application/json", "Application/JSON; charset=utf-8", "application/json; profile=example"])("accepts exact case-insensitive media type with parameters: %s", async (contentType) => {
  const request = streamed([encode("{}")], { headers: { "content-type": contentType } });
  expect(await readJsonBody(request, { maxBytes: 64, contentType: "application/json" })).toEqual({ kind: "ok", value: {} });
});

test("does not enforce media type unless requested", async () => {
  expect(await readJsonBody(streamed([encode("{}")]), { maxBytes: 64 })).toEqual({ kind: "ok", value: {} });
});

test.each(["before", "during"])("honors an aborted signal %s a read and cancels", async (when) => {
  const controller = new AbortController();
  const cancel = mock(() => {});
  const request = streamed([encode("{")], { signal: controller.signal, close: false, cancel });
  if (when === "before") controller.abort();
  const result = readJsonBody(request, { maxBytes: 64 });
  if (when === "during") controller.abort();
  expect(await result).toEqual({ kind: "aborted" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request.body?.locked).toBe(false);
});

test("aborts while waiting for the next streamed chunk", async () => {
  const controller = new AbortController();
  const cancel = mock(() => {});
  let pulls = 0;
  const request = new Request("https://home.test", {
    method: "POST",
    signal: controller.signal,
    body: new ReadableStream<Uint8Array>({
      pull(stream) {
        pulls++;
        if (pulls === 1) stream.enqueue(encode("{"));
        else controller.abort();
      },
      cancel,
    }, { highWaterMark: 0 }),
  });
  expect(await readJsonBody(request, { maxBytes: 64 })).toEqual({ kind: "aborted" });
  expect(pulls).toBe(2);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request.body?.locked).toBe(false);
});

test("times out a stalled read and cancels without waiting for cancellation", async () => {
  const cancel = mock(() => new Promise<void>(() => {}));
  const request = streamed([], { close: false, cancel });
  expect(await readJsonBody(request, { maxBytes: 64, timeoutMs: 1 })).toEqual({ kind: "aborted" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request.body?.locked).toBe(false);
});

test("maps stream failures to invalid bytes or malformed JSON and releases the reader", async () => {
  for (const json of [false, true]) {
    const request = new Request("https://home.test", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("read failed")); } }),
    });
    const result = json ? await readJsonBody(request, { maxBytes: 64 }) : await readBoundedRequestBytes(request, { maxBytes: 64 });
    expect(result).toEqual({ kind: json ? "malformed" : "invalid" });
    expect(request.body?.locked).toBe(false);
  }
});
