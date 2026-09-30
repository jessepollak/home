import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { privateVerificationPath } from "./verification-paths";

export const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";
export const defaultOtpSender = "no-reply@info.coinbase.com";

const otpLockStaleMs = 8 * 60_000;
const otpLockUnownedGraceMs = 30_000;
const otpLockWaitMs = 4 * 60_000;
const otpLockRetryMs = 1000;

type OtpLockOwner = { pid: number; host: string; startedAt: number; token: string };
type OtpLockOptions = { now?: () => number; sleep?: (milliseconds: number) => Promise<void>; writeMetadata?: (path: string, owner: OtpLockOwner) => Promise<void> };

async function lockDirectoryInfo(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
    throw new Error("Live-login lock directory must be owned by the current user, private, and not a symlink.");
  }
  return info;
}

async function lockOwner(path: string): Promise<OtpLockOwner | null> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
        throw new Error("Live-login lock metadata must be a private, current-user-owned regular file.");
      }
      const owner = JSON.parse(await file.readFile("utf8")) as Partial<OtpLockOwner> | null;
      if (owner && Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 && typeof owner.host === "string"
        && Number.isFinite(owner.startedAt) && typeof owner.token === "string") return owner as OtpLockOwner;
      return null;
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw new Error("Live-login lock metadata must be a private, current-user-owned regular file.");
  }
}

function pidIsDead(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

async function writeLockMetadata(path: string, owner: OtpLockOwner): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(owner)); } finally { await file.close(); }
}

export async function acquireGmailOtpLock(directory: string, options: OtpLockOptions = {}): Promise<() => Promise<void>> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds));
  await lockDirectoryInfo(directory);
  const path = resolve(directory, "live-login.lock");
  const metadata = resolve(path, "owner.json");
  const owner: OtpLockOwner = { pid: process.pid, host: hostname(), startedAt: now(), token: randomUUID() };
  const deadline = now() + otpLockWaitMs;
  while (true) {
    try {
      await mkdir(path, { mode: 0o700 });
      let info;
      try {
        info = await lockDirectoryInfo(path);
        await (options.writeMetadata ?? writeLockMetadata)(metadata, owner);
      } catch (error) {
        await rm(path, { recursive: true, force: true });
        throw error;
      }
      const heartbeat = setInterval(() => {
        void (async () => {
          if ((await lockDirectoryInfo(path)).ino === info.ino && (await lockOwner(metadata))?.token === owner.token) {
            const time = new Date(now());
            await utimes(path, time, time);
          }
        })().catch(() => undefined);
      }, 30_000);
      heartbeat.unref();
      return async () => {
        clearInterval(heartbeat);
        try {
          if ((await lockDirectoryInfo(path)).ino !== info.ino || (await lockOwner(metadata))?.token !== owner.token) return;
          const released = `${path}.${randomUUID()}.released`;
          try { await rename(path, released); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
          }
          if ((await lockDirectoryInfo(released)).ino !== info.ino) throw new Error("Live-login lock changed during release; retry login.");
          await rm(released, { recursive: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let info;
    try { info = await lockDirectoryInfo(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const heldBy = await lockOwner(metadata);
    if (now() - info.mtimeMs >= otpLockStaleMs || (!heldBy && now() - info.mtimeMs >= otpLockUnownedGraceMs)
      || (heldBy?.host === hostname() && pidIsDead(heldBy.pid))) {
      const current = await lockDirectoryInfo(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!current || current.ino !== info.ino || current.mtimeMs !== info.mtimeMs
        || (await lockOwner(metadata))?.token !== heldBy?.token) continue;
      const abandoned = `${path}.${randomUUID()}.stale`;
      try { await rename(path, abandoned); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if ((await lockDirectoryInfo(abandoned)).ino !== info.ino) throw new Error("Live-login lock changed during recovery; retry login.");
      await rm(abandoned, { recursive: true });
      continue;
    }
    if (now() >= deadline) throw new Error("Timed out waiting for the live-login email code lock (4 minutes).");
    await sleep(Math.min(otpLockRetryMs, deadline - now()));
  }
}

export function verifyAccountEmail(env: Record<string, string | undefined> = process.env): string {
  const email = env.HOME_VERIFY_ACCOUNT_EMAIL?.trim();
  if (!email) throw new Error("Set HOME_VERIFY_ACCOUNT_EMAIL to the bot-dedicated Home account email before live verification.");
  return email;
}

export type GmailCredentials = {
  client_id: string;
  client_secret: string;
  refresh_token?: string;
};

export type GmailMessage = {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
    body?: { data?: string };
    parts?: GmailMessage["payload"][];
  };
};

type GmailOptions = {
  fetchImplementation?: typeof fetch;
  tokenEndpoint?: string;
  apiBaseUrl?: string;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  accountEmail?: string;
};

export function gmailCredentialsPath(env: Record<string, string | undefined> = process.env): string {
  return privateVerificationPath(env.HOME_VERIFY_GMAIL_CREDENTIALS ?? resolve(homedir(), ".home-verify", "gmail.json"));
}

export async function readGmailCredentials(path: string, requireRefreshToken = true): Promise<GmailCredentials> {
  let info;
  try { info = await stat(path); } catch { throw new Error("Could not read Gmail credentials file."); }
  if ((info.mode & 0o077) !== 0) throw new Error("Gmail credentials must have mode 600.");
  let parsed: Partial<GmailCredentials>;
  try { parsed = JSON.parse(await readFile(path, "utf8")) as Partial<GmailCredentials>; }
  catch { throw new Error("Could not parse Gmail credentials file."); }
  if (!parsed.client_id || !parsed.client_secret || (requireRefreshToken && !parsed.refresh_token)) {
    throw new Error(requireRefreshToken
      ? "Gmail credentials require client_id, client_secret, and refresh_token."
      : "Gmail OAuth bootstrap requires client_id and client_secret.");
  }
  return parsed as GmailCredentials;
}

export async function writeGmailCredentials(path: string, credentials: Required<GmailCredentials>): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
    await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
  } catch {
    throw new Error("Could not save Gmail credentials file.");
  }
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
}

function messageText(message: GmailMessage): string {
  const values: string[] = [];
  if (message.snippet) values.push(message.snippet);
  const visit = (payload: GmailMessage["payload"] | undefined) => {
    if (payload?.body?.data) values.push(decodeBase64Url(payload.body.data));
    for (const part of payload?.parts ?? []) visit(part);
  };
  visit(message.payload);
  return values.join("\n");
}

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function isReadonlyScopeGrant(value: string | undefined): boolean {
  return value?.trim() === gmailReadonlyScope;
}

function sixDigitCodes(text: string): string[] {
  const codes = [
    ...[...text.matchAll(/(?:^|\D)(\d{3})\s(\d{3})(?!\d)/g)].map((match) => `${match[1]}${match[2]}`),
    ...[...text.matchAll(/(?:^|\D)(\d{6})(?!\d)/g)].map((match) => match[1]),
  ];
  return [...new Set(codes)];
}

export function extractOtp(message: GmailMessage, sender: string, submittedAt: number, expiresAt: number): string | null {
  const receivedAt = Number(message.internalDate ?? Number.NaN);
  if (!Number.isFinite(receivedAt) || receivedAt < submittedAt || receivedAt > expiresAt) return null;
  const fromHeader = header(message, "from").trim();
  const fromAddress = fromHeader.match(/<([^<>]+)>/)?.[1] ?? fromHeader;
  if (fromAddress.trim().toLowerCase() !== sender.trim().toLowerCase()) return null;
  const bodyCodes = sixDigitCodes(messageText(message));
  if (bodyCodes.length === 1) return bodyCodes[0];
  const subject = header(message, "subject");
  if (!/\bcode\b/i.test(subject)) return null;
  const subjectCodes = sixDigitCodes(subject);
  return subjectCodes.length === 1 ? subjectCodes[0] : null;
}

async function accessToken(credentials: Required<GmailCredentials>, options: GmailOptions): Promise<string> {
  const response = await (options.fetchImplementation ?? fetch)(options.tokenEndpoint ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error("Gmail token refresh failed.");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Gmail token refresh returned no access token.");
  return body.access_token;
}

export async function pollGmailOtp(
  credentials: Required<GmailCredentials>,
  sender: string,
  submittedAt: number,
  options: GmailOptions = {},
): Promise<string> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? "https://gmail.googleapis.com/gmail/v1";
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds) => Bun.sleep(milliseconds));
  const expiresAt = submittedAt + 5 * 60 * 1000;
  const accountEmail = options.accountEmail?.trim() || verifyAccountEmail();
  const token = await accessToken(credentials, options);
  while (now() <= expiresAt) {
    const query = `from:${sender} to:${accountEmail} after:${Math.floor(submittedAt / 1000)}`;
    const listUrl = `${apiBaseUrl}/users/me/messages?${new URLSearchParams({ q: query, maxResults: "10" })}`;
    const listResponse = await fetchImplementation(listUrl, { headers: { authorization: `Bearer ${token}` } });
    if (!listResponse.ok) throw new Error("Gmail message query failed.");
    const listed = await listResponse.json() as { messages?: Array<{ id: string }> };
    for (const item of listed.messages ?? []) {
      const messageResponse = await fetchImplementation(`${apiBaseUrl}/users/me/messages/${encodeURIComponent(item.id)}?format=full`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!messageResponse.ok) throw new Error("Gmail message read failed.");
      const code = extractOtp(await messageResponse.json() as GmailMessage, sender, submittedAt, expiresAt);
      if (code) return code;
    }
    await wait(3000);
  }
  throw new Error("No matching sign-in code arrived within five minutes.");
}

export type CallbackDecision = "ignore" | "reject" | "accept";

export function callbackDecision(url: URL, expectedState: string): CallbackDecision {
  if (url.pathname !== "/callback") return "ignore";
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (state !== null && state !== "" && state !== expectedState) return "reject";
  if (state === expectedState && code) return "accept";
  return "ignore";
}

export function gmailAuthorizationUrl(clientId: string, redirectUri: string, state: string): URL {
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: gmailReadonlyScope,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return authorization;
}

export type GmailAuthOptions = {
  open?: boolean;
  port?: number;
  fetchImplementation?: typeof fetch;
  tokenEndpoint?: string;
  apiBaseUrl?: string;
  revokeEndpoint?: string;
  accountEmail?: string;
  writeCredentials?: (path: string, credentials: Required<GmailCredentials>) => Promise<void>;
};

export async function runGmailAuth(path: string, options: GmailAuthOptions = {}): Promise<void> {
  const bootstrap = await readGmailCredentials(path, false);
  const state = crypto.randomUUID();
  let resolveCode: (code: string) => void = () => undefined;
  let rejectCode: (error: Error) => void = () => undefined;
  const codePromise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveCode = resolvePromise;
    rejectCode = rejectPromise;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    fetch(request) {
      const url = new URL(request.url);
      const decision = callbackDecision(url, state);
      if (decision === "ignore") {
        return url.pathname === "/callback"
          ? new Response("Authorization failed.", { status: 400 })
          : new Response("Not found.", { status: 404 });
      }
      if (decision === "reject") {
        setTimeout(() => rejectCode(new Error("Gmail OAuth state mismatch.")), 0);
        return new Response("Authorization failed.", { status: 400 });
      }
      resolveCode(url.searchParams.get("code") ?? "");
      return new Response("Home verification Gmail authorization complete. You may close this tab.");
    },
  });
  const redirectUri = `http://127.0.0.1:${server.port}/callback`;
  const authorization = gmailAuthorizationUrl(bootstrap.client_id, redirectUri, state);
  console.log(`Open this URL to authorize: ${authorization.toString()}`);
  if (options.open !== false) {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    const opened = Bun.spawnSync({ cmd: [opener, authorization.toString()], stdout: "ignore", stderr: "ignore" });
    if (opened.exitCode !== 0) {
      await server.stop(true);
      throw new Error("Could not open the Gmail authorization URL.");
    }
  }
  try {
    await completeGmailAuthorization(path, await codePromise, bootstrap, redirectUri, options);
  } finally {
    await server.stop(true);
  }
}

export async function completeGmailAuthorization(
  path: string,
  code: string,
  bootstrap: { client_id: string; client_secret: string },
  redirectUri: string,
  options: GmailAuthOptions = {},
): Promise<void> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? "https://gmail.googleapis.com/gmail/v1";
  const response = await fetchImplementation(options.tokenEndpoint ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: bootstrap.client_id,
      client_secret: bootstrap.client_secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) throw new Error("Gmail OAuth token exchange failed.");
  const body = await response.json() as { access_token?: string; refresh_token?: string; scope?: string };
  if (!body.refresh_token || !body.access_token || !isReadonlyScopeGrant(body.scope)) {
    throw new Error("Gmail OAuth did not return the required readonly grant.");
  }
  const accountEmail = options.accountEmail?.trim() || verifyAccountEmail();
  const profileResponse = await fetchImplementation(`${apiBaseUrl}/users/me/profile`, {
    headers: { authorization: `Bearer ${body.access_token}` },
  });
  if (!profileResponse.ok) throw new Error("Gmail profile lookup failed.");
  const grantedEmail = ((await profileResponse.json() as { emailAddress?: string }).emailAddress ?? "").trim();
  if (grantedEmail.toLowerCase() !== accountEmail.toLowerCase()) {
    await fetchImplementation(options.revokeEndpoint ?? "https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: body.refresh_token }),
    });
    throw new Error("Gmail authorization mailbox did not match the configured bot account; the grant was revoked.");
  }
  await (options.writeCredentials ?? writeGmailCredentials)(path, {
    client_id: bootstrap.client_id,
    client_secret: bootstrap.client_secret,
    refresh_token: body.refresh_token,
  });
  console.log("Gmail readonly authorization saved.");
}
