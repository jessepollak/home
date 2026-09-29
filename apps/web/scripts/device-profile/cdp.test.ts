import { expect, test } from "bun:test";
import { Cdp, activateTarget, consoleResult, endTracing, startTracing } from "./cdp";

test("CDP replies and events route by session; command errors are explicit", async () => {
  const sent: { id: number; method: string; sessionId?: string }[] = [];
  const cdp = new Cdp({ send: (data) => sent.push(JSON.parse(data)), close() {} });
  const browser = cdp.command("Target.createTarget");
  const page = cdp.command("Page.navigate", { url: "about:blank" }, "page-1");
  const events: string[] = [];
  cdp.on("Runtime.consoleAPICalled", () => events.push("one"), "page-1");
  cdp.on("Runtime.consoleAPICalled", () => events.push("two"), "page-2");
  cdp.dispatch(JSON.stringify({ id: sent[1]!.id, sessionId: "page-2", result: { wrong: true } }));
  cdp.dispatch(JSON.stringify({ method: "Runtime.consoleAPICalled", sessionId: "page-2" }));
  cdp.dispatch(JSON.stringify({ id: sent[1]!.id, sessionId: "page-1", result: { frameId: "frame" } }));
  cdp.dispatch(JSON.stringify({ id: sent[0]!.id, result: { targetId: "target" } }));
  expect(await browser).toEqual({ targetId: "target" });
  expect(await page).toEqual({ frameId: "frame" });
  expect(events).toEqual(["two"]);
  const traceComplete = cdp.waitFor("Tracing.tracingComplete");
  cdp.dispatch(JSON.stringify({ method: "Tracing.tracingComplete", sessionId: "page-1" }));
  cdp.dispatch(JSON.stringify({ method: "Tracing.tracingComplete", params: { dataLossOccurred: false } }));
  expect(await traceComplete.promise).toEqual({ dataLossOccurred: false });
  const failure = cdp.command("Tracing.start");
  cdp.dispatch(JSON.stringify({ id: sent.at(-1)!.id, error: { code: -32000, message: "denied" } }));
  await expect(failure).rejects.toThrow("CDP -32000: denied");
  cdp.close();
});

test("tracing start recovers from a failed first start by ending and draining before retry", async () => {
  const methods: string[] = [];
  const cdp = new Cdp({ send(data) {
    const { id, method } = JSON.parse(data) as { id: number; method: string };
    methods.push(method);
    queueMicrotask(() => {
      cdp.dispatch(JSON.stringify(method === "Tracing.start" && methods.length === 1 ? { id, error: { code: -32000, message: "Tracing has already been started" } } : { id, result: {} }));
      if (method === "Tracing.end") cdp.dispatch(JSON.stringify({ method: "Tracing.tracingComplete" }));
    });
  }, close() {} });
  await startTracing(cdp);
  await endTracing(cdp);
  expect(methods).toEqual(["Tracing.start", "Tracing.end", "Tracing.start", "Tracing.end"]);
  cdp.close();
});

test("tracing completion reports whether Chrome dropped trace events", async () => {
  const tracingComplete = (params: Record<string, unknown>) => {
    const cdp = new Cdp({ send(data) {
      const { id, method } = JSON.parse(data) as { id: number; method: string };
      cdp.dispatch(JSON.stringify({ id, result: {} }));
      if (method === "Tracing.end") queueMicrotask(() => cdp.dispatch(JSON.stringify({ method: "Tracing.tracingComplete", params })));
    }, close() {} });
    return cdp;
  };
  const lossy = tracingComplete({ dataLossOccurred: true });
  await expect(endTracing(lossy)).resolves.toEqual({ dataLossOccurred: true });
  lossy.close();
  const clean = tracingComplete({ dataLossOccurred: false });
  await expect(endTracing(clean)).resolves.toEqual({ dataLossOccurred: false });
  clean.close();
  const silent = tracingComplete({});
  await expect(endTracing(silent)).resolves.toEqual({ dataLossOccurred: false });
  silent.close();
});

test("tracing start failure retries only once and ends any late trace", async () => {
  const methods: string[] = [];
  const cdp = new Cdp({ send(data) {
    const { id, method } = JSON.parse(data) as { id: number; method: string };
    methods.push(method);
    queueMicrotask(() => {
      cdp.dispatch(JSON.stringify(method === "Tracing.start" ? { id, error: { code: -32000, message: "already started" } } : { id, result: {} }));
      if (method === "Tracing.end") cdp.dispatch(JSON.stringify({ method: "Tracing.tracingComplete" }));
    });
  }, close() {} });
  await expect(startTracing(cdp)).rejects.toThrow("already started");
  expect(methods).toEqual(["Tracing.start", "Tracing.end", "Tracing.start", "Tracing.end"]);
  cdp.close();
});

test("console result parses only valid prefixed lines", () => {
  const result = { version: 1 as const, plan: { workload: "home-fling" as const, rows: 20, repeat: 1, label: "android", duration: 10 }, environment: { userAgent: "Chrome", viewport: { width: 390, height: 844 }, dpr: 2, standalone: false, navigatorStandalone: false, supportedEntryTypes: [] }, runs: [] };
  expect(consoleResult({ args: [{ value: `HOME_DEVICE_PROFILE_RESULT ${JSON.stringify(result)}` }] })).toEqual(result);
  expect(consoleResult({ args: [{ value: "other" }] })).toBeNull();
  expect(consoleResult({ args: [{ value: "HOME_DEVICE_PROFILE_RESULT {" }] })).toBeNull();
  expect(consoleResult({ args: [{ value: 1 }] })).toBeNull();
  expect(consoleResult({ args: [{ value: "HOME_DEVICE_PROFILE_RESULT {\"version\":2}" }] })).toBeNull();
  expect(consoleResult({ args: [{ value: "HOME_DEVICE_PROFILE_RESULT {\"version\":1}" }] })).toBeNull();
});

test("a refused activation or a hidden page fails the workload instead of measuring it", async () => {
  const fake = (respond: (method: string) => unknown) => {
    const instance = new Cdp({ send(data) {
      const { id, method, sessionId } = JSON.parse(data) as { id: number; method: string; sessionId?: string };
      queueMicrotask(() => instance.dispatch(JSON.stringify({ id, ...sessionId ? { sessionId } : {}, ...(respond(method) as object) })));
    }, close() {} });
    return instance;
  };
  const refused = fake(() => ({ error: { code: -32000, message: "no such target" } }));
  await expect(activateTarget(refused, "target", "session")).rejects.toThrow("refused to activate");
  refused.close();
  const hidden = fake((method) => method === "Runtime.evaluate" ? { result: { result: { value: "hidden" } } } : { result: {} });
  await expect(activateTarget(hidden, "target", "session")).rejects.toThrow("not visible");
  hidden.close();
  const unreadable = fake(() => ({ result: {} }));
  await expect(activateTarget(unreadable, "target", "session")).rejects.toThrow("not visible");
  unreadable.close();
  const visible = fake((method) => method === "Runtime.evaluate" ? { result: { result: { value: "visible" } } } : { result: {} });
  await expect(activateTarget(visible, "target", "session")).resolves.toBeUndefined();
  visible.close();
});
