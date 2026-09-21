import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";
export const defaultOtpSender = "no-reply@coinbase.com";

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
};

export function gmailCredentialsPath(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.HOME_VERIFY_GMAIL_CREDENTIALS ?? resolve(homedir(), ".home-verify", "gmail.json"));
}

export async function readGmailCredentials(path: string, requireRefreshToken = true): Promise<GmailCredentials> {
  const info = await stat(path);
  if ((info.mode & 0o077) !== 0) throw new Error("Gmail credentials must have mode 600.");
  const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<GmailCredentials>;
  if (!parsed.client_id || !parsed.client_secret || (requireRefreshToken && !parsed.refresh_token)) {
    throw new Error(requireRefreshToken
      ? "Gmail credentials require client_id, client_secret, and refresh_token."
      : "Gmail OAuth bootstrap requires client_id and client_secret.");
  }
  return parsed as GmailCredentials;
}

export async function writeGmailCredentials(path: string, credentials: Required<GmailCredentials>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
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

export function extractOtp(message: GmailMessage, sender: string, submittedAt: number, expiresAt: number): string | null {
  const receivedAt = Number(message.internalDate ?? Number.NaN);
  if (!Number.isFinite(receivedAt) || receivedAt < submittedAt || receivedAt > expiresAt) return null;
  const from = header(message, "from").toLowerCase();
  if (!from.includes(sender.toLowerCase())) return null;
  const codes = [...messageText(message).matchAll(/(?:^|\D)(\d{6})(?!\d)/g)].map((match) => match[1]);
  const distinct = [...new Set(codes)];
  return distinct.length === 1 ? distinct[0] : null;
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
  const token = await accessToken(credentials, options);
  while (now() <= expiresAt) {
    const query = `from:${sender} after:${Math.floor(submittedAt / 1000)}`;
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

export async function runGmailAuth(path: string): Promise<void> {
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
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.searchParams.get("state") !== state) {
        rejectCode(new Error("Gmail OAuth state mismatch."));
        return new Response("Authorization failed.", { status: 400 });
      }
      const code = url.searchParams.get("code");
      if (!code) {
        rejectCode(new Error("Gmail OAuth returned no code."));
        return new Response("Authorization failed.", { status: 400 });
      }
      resolveCode(code);
      return new Response("Home verification Gmail authorization complete. You may close this tab.");
    },
  });
  const redirectUri = `http://127.0.0.1:${server.port}/callback`;
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: bootstrap.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: gmailReadonlyScope,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  const opened = Bun.spawnSync({ cmd: [opener, authorization.toString()], stdout: "ignore", stderr: "ignore" });
  if (opened.exitCode !== 0) {
    server.stop(true);
    throw new Error("Could not open the Gmail authorization URL.");
  }
  try {
    const code = await codePromise;
    const response = await fetch("https://oauth2.googleapis.com/token", {
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
    const body = await response.json() as { refresh_token?: string; scope?: string };
    if (!body.refresh_token || !isReadonlyScopeGrant(body.scope)) {
      throw new Error("Gmail OAuth did not return the required readonly grant.");
    }
    await writeGmailCredentials(path, {
      client_id: bootstrap.client_id,
      client_secret: bootstrap.client_secret,
      refresh_token: body.refresh_token,
    });
  } finally {
    server.stop(true);
  }
}
