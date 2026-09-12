import { describe, expect, test } from "bun:test";
import {
  HOME_CHALLENGE_COOKIE,
  HOME_SESSION_COOKIE,
  MemoryNativeBaseNonceStore,
  NATIVE_BASE_NONCE_TTL_MS,
  PostgresNativeBaseNonceStore,
  createNativeBaseLogoutHandler,
  createNativeBaseNonceHandler,
  createNativeBaseVerifyHandler,
  readNativeBaseSession,
  resolveNativeBaseNonceStoreBackend,
  type NativeBaseNonce,
} from "./native-base-session";
import type { SqlExecutor, SqlQueryResult } from "@/server/money-actions/postgres-sql";

const SECRET = "test-only-home-session-secret-32-bytes-minimum";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const ORIGIN = "http://127.0.0.1:3103";
const START = new Date("2026-09-12T12:00:00.000Z");
const ID = "a".repeat(48);

function post(
  path: string,
  body: unknown,
  cookie?: string,
  origin = ORIGIN,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function logoutRequest(headers: Record<string, string> = {}): Request {
  return post("/api/auth/base/logout", {}, undefined, ORIGIN, headers);
}

function cookieValue(response: Response, name: string): string {
  const header = response.headers.get("set-cookie") ||
    response.headers.getSetCookie().join(",") || "";
  const match = new RegExp(`${name}=([^;,]+)`).exec(header);
  if (!match?.[1]) throw new Error(`Missing ${name} cookie`);
  return `${name}=${match[1]}`;
}

function handlers(store = new MemoryNativeBaseNonceStore(), now = () => START) {
  const deps = {
    sessionSecret: SECRET,
    store,
    now,
    randomId: () => ID,
    verify: async () => true,
  };
  return {
    nonce: createNativeBaseNonceHandler(deps),
    verify: createNativeBaseVerifyHandler(deps),
  };
}

async function challenge(
  nonce: ReturnType<typeof createNativeBaseNonceHandler>,
): Promise<{ message: string; cookie: string }> {
  const response = await nonce(post("/api/auth/base/nonce", { address: ADDRESS }));
  expect(response.status).toBe(200);
  const payload = await response.json() as { message: string };
  return { message: payload.message, cookie: cookieValue(response, HOME_CHALLENGE_COOKIE) };
}

describe("native Base authentication handlers", () => {
  test("requires HOME_SESSION_SECRET before issuing a local-memory challenge", async () => {
    const store = new MemoryNativeBaseNonceStore();
    const nonce = createNativeBaseNonceHandler({
      sessionSecret: "",
      store,
      now: () => START,
      randomId: () => ID,
    });
    const response = await nonce(post("/api/auth/base/nonce", { address: ADDRESS }));
    expect(response.status).toBe(503);
    expect(await store.consume(ID, START.toISOString())).toBeNull();
  });

  test("issues one Base-bound proof, establishes a signed HttpOnly session, and rejects replay", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    expect(issued.message).toContain("Chain ID: 8453");
    expect(issued.message).toContain(`URI: ${ORIGIN}`);

    const verified = await verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
      issued.cookie,
    ));
    expect(verified.status).toBe(200);
    const setCookie = verified.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${HOME_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(await verified.json()).toEqual({
      user: { subject: expect.stringMatching(/^base-[0-9a-f]{32}$/) },
      smartAccount: { address: ADDRESS, chainId: 8453 },
      accountProvider: "base-account",
    });

    const replay = await verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
      issued.cookie,
    ));
    expect(replay.status).toBe(401);
  });

  test("fails closed for wrong domain, wrong chain, expiry, and invalid signatures", async () => {
    for (const mutate of [
      (message: string) => message.replace(`URI: ${ORIGIN}`, "URI: https://evil.example"),
      (message: string) => message.replace("Chain ID: 8453", "Chain ID: 1"),
    ]) {
      const { nonce, verify } = handlers();
      const issued = await challenge(nonce);
      const response = await verify(post(
        "/api/auth/base/verify",
        { message: mutate(issued.message), signature: "0x1234" },
        issued.cookie,
      ));
      expect(response.status).toBe(401);
    }

    let current = START;
    const expiring = handlers(new MemoryNativeBaseNonceStore(), () => current);
    const issued = await challenge(expiring.nonce);
    current = new Date(START.getTime() + NATIVE_BASE_NONCE_TTL_MS + 1);
    expect((await expiring.verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
      issued.cookie,
    ))).status).toBe(401);

    const invalidStore = new MemoryNativeBaseNonceStore();
    const invalidDependencies = {
      sessionSecret: SECRET,
      store: invalidStore,
      now: () => START,
      randomId: () => ID,
    };
    const invalid = createNativeBaseVerifyHandler({
      ...invalidDependencies,
      verify: async () => false,
    });
    const invalidNonce = createNativeBaseNonceHandler(invalidDependencies);
    const separate = await challenge(invalidNonce);
    expect((await invalid(post(
      "/api/auth/base/verify",
      { message: separate.message, signature: "0x1234" },
      separate.cookie,
    ))).status).toBe(401);
  });

  test("allows only one concurrent verification and logout clears both auth cookies", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    const request = () => post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
      issued.cookie,
    );
    const responses = await Promise.all([verify(request()), verify(request())]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);

    const logout = await createNativeBaseLogoutHandler()(logoutRequest({
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
    }));
    const cookies = logout.headers.get("set-cookie") ?? "";
    expect(logout.status).toBe(200);
    expect(cookies).toContain(`${HOME_CHALLENGE_COOKIE}=`);
    expect(cookies).toContain(`${HOME_SESSION_COOKIE}=`);
    expect(cookies).toContain("Max-Age=0");
  });

  test("rejects logout CSRF without clearing authentication cookies", async () => {
    const logout = createNativeBaseLogoutHandler();
    for (const request of [
      logoutRequest(),
      logoutRequest({ Origin: "https://evil.example" }),
      logoutRequest({ Origin: `${ORIGIN}/` }),
      logoutRequest({ Origin: "null" }),
      logoutRequest({
        Origin: ORIGIN,
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      }),
    ]) {
      const response = await logout(request);
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toEqual([]);
    }

    const withoutFetchMetadata = await logout(logoutRequest({ Origin: ORIGIN }));
    expect(withoutFetchMetadata.status).toBe(200);
    expect(withoutFetchMetadata.headers.getSetCookie()).toHaveLength(2);
  });

  test("reads only valid signed Base sessions and rejects cookie tampering", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    const response = await verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
      issued.cookie,
    ));
    const sessionCookie = cookieValue(response, HOME_SESSION_COOKIE);
    const valid = readNativeBaseSession(new Request(`${ORIGIN}/api/session`, {
      headers: { Cookie: sessionCookie },
    }), SECRET, START);
    expect(valid.kind).toBe("valid");

    const tampered = `${sessionCookie.slice(0, -1)}x`;
    expect(readNativeBaseSession(new Request(`${ORIGIN}/api/session`, {
      headers: { Cookie: tampered },
    }), SECRET, START)).toEqual({ kind: "invalid" });
  });
});

class FakeNonceExecutor implements SqlExecutor {
  readonly rows = new Map<string, NonceRow>();
  schemaAttempts = 0;
  schemaLocks = 0;
  failSchemaAttempts = 0;

  async query<T = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<SqlQueryResult<T>> {
    if (text.startsWith("SELECT pg_advisory_xact_lock")) {
      this.schemaLocks += 1;
      expect(values).toEqual(["5210468254237152596"]);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("CREATE TABLE")) {
      this.schemaAttempts += 1;
      if (this.failSchemaAttempts > 0) {
        this.failSchemaAttempts -= 1;
        throw new Error("Transient schema failure");
      }
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith("DELETE FROM home_auth_nonces WHERE expires_at")) {
      for (const [id, row] of this.rows) {
        if (row.expires_at <= String(values[0])) this.rows.delete(id);
      }
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith("INSERT INTO home_auth_nonces")) {
      this.rows.set(String(values[0]), {
        id: String(values[0]),
        address: String(values[1]),
        origin: String(values[2]),
        message: String(values[3]),
        expires_at: String(values[4]),
      });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("DELETE FROM home_auth_nonces\n  WHERE id")) {
      if (values.length !== 1) throw new Error("Unexpected nonce consume parameters");
      const id = String(values[0]);
      const row = this.rows.get(id);
      if (!row) return { rows: [], rowCount: 0 };
      this.rows.delete(id);
      return { rows: [row as T], rowCount: 1 };
    }
    throw new Error("Unexpected SQL");
  }
  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

type NonceRow = {
  id: string;
  address: string;
  origin: string;
  message: string;
  expires_at: string;
};

function storedNonce(id: string, expiresAt: string): NativeBaseNonce {
  return { id, address: ADDRESS, origin: ORIGIN, message: `message-${id}`, expiresAt };
}

describe("native Base nonce stores", () => {
  test("memory store atomically consumes once and rejects expiry", async () => {
    const store = new MemoryNativeBaseNonceStore();
    const active = storedNonce("active", "2026-09-12T12:05:00.000Z");
    await store.issue(active);
    const concurrent = await Promise.all([
      store.consume(active.id, START.toISOString()),
      store.consume(active.id, START.toISOString()),
    ]);
    expect(concurrent.filter(Boolean)).toHaveLength(1);

    const expired = storedNonce("expired", START.toISOString());
    await store.issue(expired);
    expect(await store.consume(expired.id, START.toISOString())).toBeNull();
  });

  test("Postgres schema readiness is single-flight and retries a transient initialization failure", async () => {
    const concurrentExecutor = new FakeNonceExecutor();
    const concurrentStore = new PostgresNativeBaseNonceStore(concurrentExecutor);
    await Promise.all([
      concurrentStore.issue(storedNonce("first", "2026-09-12T12:05:00.000Z")),
      concurrentStore.issue(storedNonce("second", "2026-09-12T12:05:00.000Z")),
    ]);
    expect(concurrentExecutor.schemaLocks).toBe(1);
    expect(concurrentExecutor.schemaAttempts).toBe(1);
    await concurrentStore.consume("first", START.toISOString());
    expect(concurrentExecutor.schemaAttempts).toBe(1);

    const retryExecutor = new FakeNonceExecutor();
    retryExecutor.failSchemaAttempts = 1;
    const retryStore = new PostgresNativeBaseNonceStore(retryExecutor);
    await expect(
      retryStore.issue(storedNonce("retry", "2026-09-12T12:05:00.000Z")),
    ).rejects.toThrow("Transient schema failure");
    await retryStore.issue(storedNonce("retry", "2026-09-12T12:05:00.000Z"));
    expect(retryExecutor.schemaLocks).toBe(2);
    expect(retryExecutor.schemaAttempts).toBe(2);
    expect(retryExecutor.rows.has("retry")).toBe(true);
  });

  test("Postgres store uses atomic DELETE RETURNING for replay, concurrency, and expiry", async () => {
    const executor = new FakeNonceExecutor();
    const store = new PostgresNativeBaseNonceStore(executor);
    const active = storedNonce("active", "2026-09-12T12:05:00.000Z");
    await store.issue(active);
    const concurrent = await Promise.all([
      store.consume(active.id, START.toISOString()),
      store.consume(active.id, START.toISOString()),
    ]);
    expect(concurrent.filter(Boolean)).toHaveLength(1);
    expect(await store.consume(active.id, START.toISOString())).toBeNull();

    await store.issue(storedNonce("expired", START.toISOString()));
    expect(await store.consume("expired", START.toISOString())).toBeNull();
  });

  test("requires durable Postgres outside exact local development and test environments", () => {
    for (const env of [
      {},
      { NODE_ENV: "" },
      { NODE_ENV: "unknown" },
      { NODE_ENV: "staging" },
      { NODE_ENV: "preview" },
      { NODE_ENV: "production" },
    ]) {
      expect(resolveNativeBaseNonceStoreBackend(env)).toBe("hosted-unavailable");
    }
    expect(resolveNativeBaseNonceStoreBackend({ NODE_ENV: "development" })).toBe("memory");
    expect(resolveNativeBaseNonceStoreBackend({ NODE_ENV: "test" })).toBe("memory");
    expect(resolveNativeBaseNonceStoreBackend({
      NODE_ENV: "production",
      AWS_EXECUTION_ENV: "AWS_Lambda_nodejs22.x",
    })).toBe("hosted-unavailable");
    expect(resolveNativeBaseNonceStoreBackend({
      NODE_ENV: "test",
      AWS_LAMBDA_FUNCTION_NAME: "home-auth",
    })).toBe("hosted-unavailable");
    expect(resolveNativeBaseNonceStoreBackend({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example/home",
    })).toBe("postgres");
  });
});
