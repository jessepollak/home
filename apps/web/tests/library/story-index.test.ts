import { afterEach, expect, test } from "bun:test";
import { loadLibraryIndex } from "../../stories/review/explorations/library/story-index";
import type { StoryIndexEntry } from "../../stories/review/explorations/board/review-build";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const entry: StoryIndexEntry = {
  id: "ui-button--default", title: "UI/Button", name: "Default",
  importPath: "./components/ui/button.stories.tsx", type: "story", tags: ["test"],
};
const entries = { [entry.id]: entry };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

function fixture() {
  let callback: (() => void) | undefined;
  let delay: number | undefined;
  const updates: Array<Record<string, StoryIndexEntry> | "unavailable"> = [];
  const clock = {
    schedule(run: () => void, ms: number) {
      callback = run;
      delay = ms;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    cancel() { callback = undefined; },
  };
  const cancel = loadLibraryIndex((index) => updates.push(index), clock);
  return { updates, cancel, expire: () => callback?.(), delay: () => delay, pending: () => !!callback };
}

for (const phase of ["fetch", "body"]) {
  test(`a pending ${phase} becomes unavailable at the shared deadline and aborts the request`, async () => {
    const response = deferred<Response>();
    const body = deferred<unknown>();
    let signal: AbortSignal | undefined;
    globalThis.fetch = (async (_input, options) => {
      signal = options?.signal ?? undefined;
      return response.promise;
    }) as typeof fetch;
    const load = fixture();
    if (phase === "body") {
      response.resolve({ ok: true, json: () => body.promise } as Response);
      await flush();
    }
    expect(load.updates).toEqual([]);
    expect(signal?.aborted).toBe(false);
    expect(load.delay()).toBe(20_000);
    load.expire();
    expect(signal?.aborted).toBe(true);
    expect(load.updates).toEqual(["unavailable"]);
    expect(load.pending()).toBe(false);
    if (phase === "fetch") response.resolve(new Response(JSON.stringify({ entries })));
    else body.resolve({ entries });
    await flush();
    expect(load.updates).toEqual(["unavailable"]);
    load.cancel();
  });
}

const malformed: unknown[] = [
  { v: 5 }, null, [], { entries: null }, { entries: [] }, { entries: "stories" },
  { entries: 5 }, { entries: true }, { entries: new Date("2026-01-01T00:00:00Z") },
  { entries: { bad: null } }, { entries: { bad: {} } },
  { entries: { bad: { ...entry, title: 5 } } }, { entries: { bad: { ...entry, tags: [5] } } },
];
for (const [id, data] of malformed.entries()) {
  test(`invalid index envelope ${id} becomes unavailable and cancels the deadline`, async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => data })) as unknown as typeof fetch;
    const load = fixture();
    await flush();
    expect(load.updates).toEqual(["unavailable"]);
    expect(load.pending()).toBe(false);
    load.cancel();
  });
}

for (const data of [{ v: 5, entries }, { entries: {} }]) {
  test(`a valid ${Object.keys(data.entries).length ? "populated" : "empty"} index completes and cancels the deadline`, async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(data))) as unknown as typeof fetch;
    const load = fixture();
    await flush();
    expect(load.updates).toEqual([data.entries]);
    expect(load.pending()).toBe(false);
    load.expire();
    expect(load.updates).toHaveLength(1);
    load.cancel();
  });
}

for (const failure of ["http", "json", "network"]) {
  test(`${failure} failure becomes unavailable without leaving a deadline`, async () => {
    globalThis.fetch = (async () => {
      if (failure === "network") throw new Error("Offline");
      return failure === "http" ? new Response(null, { status: 503 }) : new Response("{invalid");
    }) as unknown as typeof fetch;
    const load = fixture();
    await flush();
    expect(load.updates).toEqual(["unavailable"]);
    expect(load.pending()).toBe(false);
    load.cancel();
  });
}

for (const phase of ["fetch", "body", "rejection"]) {
  test(`unmount during ${phase} aborts and never sets state after late completion`, async () => {
    const response = deferred<Response>();
    const body = deferred<unknown>();
    let signal: AbortSignal | undefined;
    globalThis.fetch = (async (_input, options) => {
      signal = options?.signal ?? undefined;
      return response.promise;
    }) as typeof fetch;
    const load = fixture();
    if (phase === "body") {
      response.resolve({ ok: true, json: () => body.promise } as Response);
      await flush();
    }
    load.cancel();
    expect(signal?.aborted).toBe(true);
    expect(load.pending()).toBe(false);
    load.expire();
    if (phase === "body") body.resolve({ entries });
    else if (phase === "rejection") response.reject(new Error("Aborted"));
    else response.resolve(new Response(JSON.stringify({ entries })));
    await flush();
    expect(load.updates).toEqual([]);
  });
}
