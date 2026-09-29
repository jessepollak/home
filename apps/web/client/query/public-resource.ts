import { DeploymentExpiredError, deploymentHeaders } from "./deployment-headers";

export type PublicResourceOptions = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onDeploymentExpired?: (deploymentId: string) => void;
};

export class PublicResourceError extends Error {
  constructor(
    public kind: "network" | "http" | "parse",
    public status: number | null,
    public body: unknown = undefined,
  ) {
    super(`Public resource ${kind} failure`);
    this.name = "PublicResourceError";
  }
}

const reloadedDeploymentsKey = "home.deployment-reload.v1";
const maxReloadedDeployments = 10;

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

function isSameOriginPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  try {
    return new URL(path, "https://home.invalid").origin === "https://home.invalid";
  } catch {
    return false;
  }
}

export function reloadForExpiredDeployment(
  id: string,
  { storage, reload }: {
    storage?: Pick<Storage, "getItem" | "setItem">;
    reload?: () => void;
  } = {},
): void {
  if (typeof window === "undefined" && (!storage || !reload)) return;
  try {
    const target = storage ?? window.sessionStorage;
    const stored: unknown = JSON.parse(target.getItem(reloadedDeploymentsKey) ?? "[]");
    const reloaded = Array.isArray(stored) ? stored.filter((value) => typeof value === "string") : [];
    if (reloaded.includes(id)) return;
    target.setItem(reloadedDeploymentsKey, JSON.stringify([...reloaded, id].slice(-maxReloadedDeployments)));
  } catch {
    return undefined;
  }
  (reload ?? (() => window.location.reload()))();
}

export async function publicResource(path: string, options: PublicResourceOptions = {}): Promise<unknown> {
  if (!isSameOriginPath(path)) {
    throw new TypeError("Public resource path must be same-origin relative.");
  }
  const headers = { ...deploymentHeaders(), accept: "application/json", ...options.headers };
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(path, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (isAbort(error, options.signal)) throw error;
    throw new PublicResourceError("network", null);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (isAbort(error, options.signal)) throw error;
    throw new PublicResourceError("parse", response.status);
  }
  let body: unknown;
  let isJson = false;
  try {
    body = JSON.parse(text);
    isJson = true;
  } catch (error) {
    if (options.signal?.aborted) throw error;
  }
  const id = new Headers(headers).get("x-deployment-id");
  if (response.status === 404 && id && !isJson) {
    (options.onDeploymentExpired ?? reloadForExpiredDeployment)(id);
    throw new DeploymentExpiredError();
  }
  if (!response.ok) throw new PublicResourceError("http", response.status, body);
  if (!isJson) throw new PublicResourceError("parse", response.status);
  return body;
}
