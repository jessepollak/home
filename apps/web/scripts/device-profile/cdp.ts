import { validResult, type Result } from "./model";

type Reply = { id?: number; sessionId?: string; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { code: number; message: string } };
type Listener = (params: Record<string, unknown>) => void;

export function consoleResult(params: Record<string, unknown>): Result | null {
  const args = params.args;
  if (!Array.isArray(args)) return null;
  const text = args.map((arg: { value?: unknown }) => arg.value).filter((value): value is string => typeof value === "string").join(" ");
  const prefix = "HOME_DEVICE_PROFILE_RESULT ";
  if (!text.startsWith(prefix)) return null;
  try { const parsed: unknown = JSON.parse(text.slice(prefix.length)); return validResult(parsed) ? parsed : null; } catch { return null; }
}

export function evaluatedValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("result" in value)) return undefined;
  const inner = value.result;
  return inner && typeof inner === "object" && "value" in inner ? inner.value : undefined;
}

/** Bring the profiling page to the front or fail the workload. A background page has its
 * animation frames and timers throttled, so its frame periods and missed deadlines are invalid. */
export async function activateTarget(cdp: Cdp, targetId: string, session: string) {
  try { await cdp.command("Target.activateTarget", { targetId }); }
  catch (error) { throw new Error(`Chrome refused to activate the profiling target, so a throttled background page would be measured (${String(error)})`); }
  const state = await cdp.command("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }, session).then(evaluatedValue, () => undefined);
  if (state !== "visible") throw new Error(`The profiling target is not visible (visibilityState ${typeof state === "string" ? state : "unavailable"}); bring Chrome to the foreground before measuring`);
}

export class Cdp {
  private nextId = 0;
  private pending = new Map<number, { session?: string; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Map<string, Set<Listener>>();
  private closed = false;
  constructor(private socket: { send(data: string): void; close(): void }) {}
  command(method: string, params: Record<string, unknown> = {}, session?: string, timeout = 10000): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("CDP connection closed"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out after ${timeout}ms`)); }, timeout);
      this.pending.set(id, { session, resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...session ? { sessionId: session } : {} })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  on(method: string, listener: Listener, session?: string) {
    const key = `${session ?? ""}:${method}`;
    const listeners = this.listeners.get(key) ?? new Set<Listener>();
    listeners.add(listener); this.listeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }
  waitFor(method: string, session?: string, timeout = 60000) {
    let dispose = () => {};
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => { dispose(); reject(new Error(`CDP ${method} timed out after ${timeout}ms`)); }, timeout);
      const off = this.on(method, (params) => { dispose(); resolve(params); }, session);
      dispose = () => { clearTimeout(timer); off(); };
    });
    return { promise, cancel: () => dispose() };
  }
  dispatch(raw: string) {
    let message: Reply;
    try { message = JSON.parse(raw) as Reply; } catch { return; }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending || pending.session !== message.sessionId) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
    } else if (message.method) {
      for (const listener of this.listeners.get(`${message.sessionId ?? ""}:${message.method}`) ?? []) listener(message.params ?? {});
    }
  }
  close(error = new Error("CDP connection closed")) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.listeners.clear(); this.socket.close();
  }
}

export async function endTracing(cdp: Cdp, timeout = 10000) {
  const completed = cdp.waitFor("Tracing.tracingComplete", undefined, timeout);
  void completed.promise.catch(() => {});
  let params: Record<string, unknown> = {};
  try { await cdp.command("Tracing.end", {}, undefined, timeout); params = await completed.promise; }
  finally { completed.cancel(); }
  return { dataLossOccurred: params.dataLossOccurred === true };
}

export async function startTracing(cdp: Cdp) {
  const params = { categories: "devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,blink.user_timing,loading", transferMode: "ReportEvents" };
  try { await cdp.command("Tracing.start", params); }
  catch {
    await endTracing(cdp).catch(() => {});
    try { await cdp.command("Tracing.start", params); }
    catch (error) { await endTracing(cdp).catch(() => {}); throw error; }
  }
}

export async function connectCdp(port: number): Promise<Cdp> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Chrome CDP /json/version: HTTP ${response.status}`);
  const version = await response.json() as { webSocketDebuggerUrl?: string };
  if (!version.webSocketDebuggerUrl) throw new Error("Chrome CDP missing browser WebSocket endpoint");
  const endpoint = new URL(version.webSocketDebuggerUrl);
  endpoint.hostname = "127.0.0.1"; endpoint.port = String(port);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint.href);
    let settled = false;
    const timer = setTimeout(() => { settled = true; socket.close(); reject(new Error("Chrome CDP WebSocket connection timed out after 3000ms")); }, 3000);
    socket.addEventListener("open", () => {
      if (settled) { socket.close(); return; }
      settled = true; clearTimeout(timer);
      const cdp = new Cdp(socket);
      socket.addEventListener("message", (event) => cdp.dispatch(String(event.data)));
      socket.addEventListener("close", () => cdp.close());
      socket.addEventListener("error", () => cdp.close(new Error("Chrome CDP WebSocket failed")));
      resolve(cdp);
    }, { once: true });
    socket.addEventListener("error", () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error("Chrome CDP WebSocket failed")); }, { once: true });
  });
}
