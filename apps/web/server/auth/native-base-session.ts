import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createPublicClient, getAddress, http } from "viem";
import { base } from "viem/chains";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { resolveBaseRpcUrl } from "@/server/portfolio/rpc";
import {
  createNeonSqlExecutor,
  type SqlExecutor,
} from "@/server/money-actions/postgres-sql";

export const HOME_SESSION_COOKIE = "home-session";
export const HOME_CHALLENGE_COOKIE = "home-auth-challenge";
export const NATIVE_BASE_NONCE_TTL_MS = 5 * 60 * 1000;
export const NATIVE_BASE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NONCES = 1_000;
const MAX_BODY_BYTES = 96 * 1024;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const signaturePattern = /^0x(?:[0-9a-fA-F]{2})+$/;

export type NativeBaseNonce = {
  id: string;
  address: `0x${string}`;
  origin: string;
  message: string;
  expiresAt: string;
};

export interface NativeBaseNonceStore {
  issue(nonce: NativeBaseNonce): Promise<void>;
  consume(id: string, now: string): Promise<NativeBaseNonce | null>;
}

export class MemoryNativeBaseNonceStore implements NativeBaseNonceStore {
  private readonly values = new Map<string, NativeBaseNonce>();

  async issue(nonce: NativeBaseNonce): Promise<void> {
    this.purge(Date.parse(nonce.expiresAt) - NATIVE_BASE_NONCE_TTL_MS);
    while (this.values.size >= MAX_NONCES) {
      const oldest = this.values.keys().next().value;
      if (typeof oldest !== "string") break;
      this.values.delete(oldest);
    }
    this.values.set(nonce.id, structuredClone(nonce));
  }

  async consume(id: string, now: string): Promise<NativeBaseNonce | null> {
    const value = this.values.get(id);
    this.values.delete(id);
    if (!value || Date.parse(value.expiresAt) <= Date.parse(now)) return null;
    return structuredClone(value);
  }

  private purge(nowMs: number): void {
    for (const [id, value] of this.values) {
      if (Date.parse(value.expiresAt) <= nowMs) this.values.delete(id);
    }
  }
}

const NONCE_SCHEMA = `CREATE TABLE IF NOT EXISTS home_auth_nonces (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  origin TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`;
const LOCK_NONCE_SCHEMA = "SELECT pg_advisory_xact_lock($1)";
const NONCE_SCHEMA_LOCK_ID = "5210468254237152596";
const INSERT_NONCE = `INSERT INTO home_auth_nonces (id, address, origin, message, expires_at)
  VALUES ($1, $2, $3, $4, $5)`;
const CONSUME_NONCE = `DELETE FROM home_auth_nonces
  WHERE id = $1
  RETURNING id, address, origin, message, expires_at`;
const DELETE_EXPIRED_NONCES = `DELETE FROM home_auth_nonces WHERE expires_at <= $1`;

type NonceRow = {
  id: string;
  address: string;
  origin: string;
  message: string;
  expires_at: string;
};

export class PostgresNativeBaseNonceStore implements NativeBaseNonceStore {
  private readonly executor: SqlExecutor;
  private schemaReady: Promise<void> | null = null;

  constructor(executorOrUrl?: SqlExecutor | string) {
    if (typeof executorOrUrl === "object") {
      this.executor = executorOrUrl;
      return;
    }
    const url = executorOrUrl?.trim() || process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL is required for native Base nonce storage");
    this.executor = createNeonSqlExecutor(url);
  }

  private initializeSchema(): Promise<void> {
    return this.executor.transaction(async (tx) => {
      await tx.query(LOCK_NONCE_SCHEMA, [NONCE_SCHEMA_LOCK_ID]);
      await tx.query(NONCE_SCHEMA);
    });
  }

  private async ensureSchema(): Promise<void> {
    const attempt = this.schemaReady ??= this.initializeSchema();
    try {
      await attempt;
    } catch (error) {
      if (this.schemaReady === attempt) this.schemaReady = null;
      throw error;
    }
  }

  async issue(nonce: NativeBaseNonce): Promise<void> {
    await this.ensureSchema();
    await this.executor.transaction(async (tx) => {
      await tx.query(DELETE_EXPIRED_NONCES, [new Date().toISOString()]);
      await tx.query(INSERT_NONCE, [
        nonce.id,
        nonce.address,
        nonce.origin,
        nonce.message,
        nonce.expiresAt,
      ]);
    });
  }

  async consume(id: string, now: string): Promise<NativeBaseNonce | null> {
    await this.ensureSchema();
    const result = await this.executor.query<NonceRow>(CONSUME_NONCE, [id]);
    const row = result.rows[0];
    if (
      !row ||
      row.expires_at <= now ||
      !addressPattern.test(row.address)
    ) return null;
    return {
      id: row.id,
      address: row.address.toLowerCase() as `0x${string}`,
      origin: row.origin,
      message: row.message,
      expiresAt: row.expires_at,
    };
  }
}

class UnavailableNativeBaseNonceStore implements NativeBaseNonceStore {
  async issue(): Promise<void> {
    throw new Error("Durable native Base nonce storage is unavailable.");
  }
  async consume(): Promise<null> {
    throw new Error("Durable native Base nonce storage is unavailable.");
  }
}

type NativeBaseRuntimeEnv = {
  DATABASE_URL?: string;
  NODE_ENV?: string;
  VERCEL?: string;
  AWS_EXECUTION_ENV?: string;
  AWS_LAMBDA_FUNCTION_NAME?: string;
  NETLIFY?: string;
  CF_PAGES?: string;
  K_SERVICE?: string;
  FUNCTION_TARGET?: string;
  WEBSITE_INSTANCE_ID?: string;
};

function isHostedOrServerlessRuntime(env: NativeBaseRuntimeEnv): boolean {
  return Boolean(
    env.VERCEL ||
      env.AWS_EXECUTION_ENV ||
      env.AWS_LAMBDA_FUNCTION_NAME ||
      env.NETLIFY ||
      env.CF_PAGES ||
      env.K_SERVICE ||
      env.FUNCTION_TARGET ||
      env.WEBSITE_INSTANCE_ID,
  );
}

export function resolveNativeBaseNonceStoreBackend(
  env: NativeBaseRuntimeEnv = process.env as NativeBaseRuntimeEnv,
): "postgres" | "memory" | "hosted-unavailable" {
  if (env.DATABASE_URL?.trim()) return "postgres";
  if (env.NODE_ENV === "production" || isHostedOrServerlessRuntime(env)) {
    return "hosted-unavailable";
  }
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return "memory";
  }
  return "hosted-unavailable";
}

let runtimeStore: NativeBaseNonceStore | null = null;
export function getNativeBaseNonceStore(): NativeBaseNonceStore {
  runtimeStore ??= (() => {
    switch (resolveNativeBaseNonceStoreBackend()) {
      case "postgres":
        return new PostgresNativeBaseNonceStore();
      case "hosted-unavailable":
        return new UnavailableNativeBaseNonceStore();
      default:
        return new MemoryNativeBaseNonceStore();
    }
  })();
  return runtimeStore;
}

export function setNativeBaseNonceStoreForTests(store: NativeBaseNonceStore | null): void {
  runtimeStore = store;
}

function normalizeSecret(secret: string | undefined | null): Buffer | null {
  const value = secret?.trim();
  if (!value || Buffer.byteLength(value, "utf8") < 32) return null;
  return Buffer.from(value, "utf8");
}

export function isHomeSessionConfigured(secret: string | undefined): boolean {
  return normalizeSecret(secret) !== null;
}

function requestOrigin(request: Request): URL | null {
  try {
    const url = new URL(request.url);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}

function isSameOriginPost(request: Request): boolean {
  if (request.method !== "POST") return false;
  const expected = requestOrigin(request)?.origin;
  const rawOrigin = request.headers.get("origin");
  if (!expected || !rawOrigin || rawOrigin === "null") return false;
  try {
    const supplied = new URL(rawOrigin);
    if (supplied.origin !== rawOrigin || supplied.origin !== expected) return false;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}

function hmac(secret: Buffer, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signedValue(secret: Buffer, value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64url");
  return `v1.${encoded}.${hmac(secret, `v1.${encoded}`)}`;
}

function readSignedValue(secret: Buffer, token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const input = `${parts[0]}.${parts[1]}`;
  if (!equalText(parts[2], hmac(secret, input))) return null;
  try {
    return Buffer.from(parts[1], "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): { present: boolean; value: string | null } {
  const header = request.headers.get("cookie");
  if (!header) return { present: false, value: null };
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length === 0) return { present: false, value: null };
  return { present: true, value: values.length === 1 && values[0] ? values[0] : null };
}

function cookie(name: string, value: string, request: Request, maxAge: number): string {
  const secure = requestOrigin(request)?.protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(name: string, request: Request): string {
  return cookie(name, "", request, 0);
}

function json(body: unknown, status: number, cookies: string[] = []): Response {
  const headers: Array<[string, string]> = [
    ["Cache-Control", "private, no-store, max-age=0"],
    ["Pragma", "no-cache"],
    ["Vary", "Cookie, Authorization, X-Home-Account-Provider"],
    ...cookies.map((value): [string, string] => ["Set-Cookie", value]),
  ];
  return Response.json(body, { status, headers });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !addressPattern.test(value)) return null;
  try {
    return getAddress(value).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

function sessionForAddress(address: `0x${string}`): VerifiedAccountSession {
  const digest = createHash("sha256").update(address).digest("hex").slice(0, 32);
  return {
    user: { subject: `base-${digest}` },
    smartAccount: { address, chainId: BASE_CHAIN_ID },
    accountProvider: "base-account",
  };
}

type SessionTokenPayload = {
  version: 1;
  session: VerifiedAccountSession;
  issuedAt: string;
  expiresAt: string;
};

function issueSessionToken(
  secret: Buffer,
  address: `0x${string}`,
  now: Date,
): { token: string; session: VerifiedAccountSession } {
  const session = sessionForAddress(address);
  const payload: SessionTokenPayload = {
    version: 1,
    session,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + NATIVE_BASE_SESSION_TTL_MS).toISOString(),
  };
  return { token: signedValue(secret, JSON.stringify(payload)), session };
}

export type NativeBaseSessionRead =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "valid"; session: VerifiedAccountSession };

export function readNativeBaseSession(
  request: Request,
  secretValue: string | undefined = process.env.HOME_SESSION_SECRET,
  now: Date = new Date(),
): NativeBaseSessionRead {
  const found = readCookie(request, HOME_SESSION_COOKIE);
  if (!found.present) return { kind: "absent" };
  const secret = normalizeSecret(secretValue);
  if (!secret || !found.value) return { kind: "invalid" };
  const raw = readSignedValue(secret, found.value);
  if (!raw) return { kind: "invalid" };
  try {
    const payload = JSON.parse(raw) as SessionTokenPayload;
    const address = normalizeAddress(payload?.session?.smartAccount?.address);
    if (
      payload.version !== 1 ||
      payload.session.accountProvider !== "base-account" ||
      payload.session.smartAccount?.chainId !== BASE_CHAIN_ID ||
      !address ||
      payload.session.user.subject !== sessionForAddress(address).user.subject ||
      !Number.isFinite(Date.parse(payload.issuedAt)) ||
      Date.parse(payload.expiresAt) <= now.getTime()
    ) return { kind: "invalid" };
    return { kind: "valid", session: sessionForAddress(address) };
  } catch {
    return { kind: "invalid" };
  }
}

export type NativeBaseAuthDependencies = {
  sessionSecret?: string;
  store?: NativeBaseNonceStore;
  now?: () => Date;
  randomId?: () => string;
  verify?: (input: {
    address: `0x${string}`;
    domain: string;
    message: string;
    nonce: string;
    signature: `0x${string}`;
  }) => Promise<boolean>;
};

function dependencies(input: NativeBaseAuthDependencies) {
  const now = input.now ?? (() => new Date());
  return {
    secret: normalizeSecret(input.sessionSecret ?? process.env.HOME_SESSION_SECRET),
    store: input.store ?? getNativeBaseNonceStore(),
    now,
    randomId: input.randomId ?? (() => randomBytes(24).toString("hex")),
    verify: input.verify ?? (async (value) => {
      const client = createPublicClient({
        chain: base,
        transport: http(resolveBaseRpcUrl()),
      });
      return client.verifySiweMessage(value);
    }),
  };
}

export function createNativeBaseNonceHandler(input: NativeBaseAuthDependencies = {}) {
  return async function POST(request: Request): Promise<Response> {
    const deps = dependencies(input);
    const origin = requestOrigin(request);
    const body = await readBody(request);
    const address = normalizeAddress(body?.address);
    if (!deps.secret) return json({ error: { code: "AUTH_UNAVAILABLE" } }, 503);
    if (!origin || !address) return json({ error: { code: "INVALID_REQUEST" } }, 400);

    const issuedAt = deps.now();
    const expiresAt = new Date(issuedAt.getTime() + NATIVE_BASE_NONCE_TTL_MS);
    const id = deps.randomId();
    if (!/^[0-9a-f]{48}$/.test(id)) return json({ error: { code: "AUTH_UNAVAILABLE" } }, 503);
    const nonce = randomBytes(16).toString("hex");
    const message = createSiweMessage({
      address,
      chainId: BASE_CHAIN_ID,
      domain: origin.host,
      uri: origin.origin,
      version: "1",
      nonce,
      issuedAt,
      expirationTime: expiresAt,
      statement: "Sign in to Home.",
    });
    try {
      await deps.store.issue({
        id,
        address,
        origin: origin.origin,
        message,
        expiresAt: expiresAt.toISOString(),
      });
    } catch {
      return json({ error: { code: "AUTH_UNAVAILABLE" } }, 503);
    }
    const challenge = signedValue(deps.secret, JSON.stringify({ id, expiresAt: expiresAt.toISOString() }));
    return json(
      { message, expiresAt: expiresAt.toISOString() },
      200,
      [cookie(HOME_CHALLENGE_COOKIE, challenge, request, NATIVE_BASE_NONCE_TTL_MS / 1000)],
    );
  };
}

export function createNativeBaseVerifyHandler(input: NativeBaseAuthDependencies = {}) {
  return async function POST(request: Request): Promise<Response> {
    const deps = dependencies(input);
    const clearChallenge = clearCookie(HOME_CHALLENGE_COOKIE, request);
    const origin = requestOrigin(request);
    const body = await readBody(request);
    const message = typeof body?.message === "string" && body.message.length <= 16_384
      ? body.message
      : null;
    const signature = typeof body?.signature === "string" &&
      body.signature.length <= 65_536 && signaturePattern.test(body.signature)
      ? body.signature.toLowerCase() as `0x${string}`
      : null;
    const challengeCookie = readCookie(request, HOME_CHALLENGE_COOKIE);
    if (!deps.secret) return json({ error: { code: "AUTH_UNAVAILABLE" } }, 503, [clearChallenge]);
    if (!origin || !message || !signature || !challengeCookie.value) {
      return json({ error: { code: "INVALID_AUTH_PROOF" } }, 401, [clearChallenge]);
    }
    const rawChallenge = readSignedValue(deps.secret, challengeCookie.value);
    let challenge: { id: string; expiresAt: string } | null = null;
    try {
      const parsed = JSON.parse(rawChallenge ?? "null") as { id?: unknown; expiresAt?: unknown } | null;
      if (
        parsed && typeof parsed.id === "string" && /^[0-9a-f]{48}$/.test(parsed.id) &&
        typeof parsed.expiresAt === "string" && Date.parse(parsed.expiresAt) > deps.now().getTime()
      ) challenge = { id: parsed.id, expiresAt: parsed.expiresAt };
    } catch {
      challenge = null;
    }
    if (!challenge) return json({ error: { code: "INVALID_AUTH_PROOF" } }, 401, [clearChallenge]);

    let nonce: NativeBaseNonce | null;
    try {
      nonce = await deps.store.consume(challenge.id, deps.now().toISOString());
    } catch {
      return json({ error: { code: "AUTH_UNAVAILABLE" } }, 503, [clearChallenge]);
    }
    if (!nonce || nonce.message !== message || nonce.origin !== origin.origin) {
      return json({ error: { code: "INVALID_AUTH_PROOF" } }, 401, [clearChallenge]);
    }

    const parsed = parseSiweMessage(message);
    if (
      parsed.address?.toLowerCase() !== nonce.address ||
      parsed.chainId !== BASE_CHAIN_ID ||
      parsed.domain !== origin.host ||
      parsed.uri !== origin.origin ||
      parsed.nonce === undefined
    ) return json({ error: { code: "INVALID_AUTH_PROOF" } }, 401, [clearChallenge]);

    let verified = false;
    try {
      verified = await deps.verify({
        address: nonce.address,
        domain: origin.host,
        message,
        nonce: parsed.nonce,
        signature,
      });
    } catch {
      return json({ error: { code: "AUTH_UNAVAILABLE" } }, 503, [clearChallenge]);
    }
    if (!verified) return json({ error: { code: "INVALID_AUTH_PROOF" } }, 401, [clearChallenge]);

    const issued = issueSessionToken(deps.secret, nonce.address, deps.now());
    return json(issued.session, 200, [
      clearChallenge,
      cookie(HOME_SESSION_COOKIE, issued.token, request, NATIVE_BASE_SESSION_TTL_MS / 1000),
    ]);
  };
}

export function createNativeBaseLogoutHandler() {
  return async function POST(request: Request): Promise<Response> {
    if (!isSameOriginPost(request)) {
      return json({ error: { code: "INVALID_REQUEST" } }, 403);
    }
    return json({ signedOut: true }, 200, [
      clearCookie(HOME_CHALLENGE_COOKIE, request),
      clearCookie(HOME_SESSION_COOKIE, request),
    ]);
  };
}
