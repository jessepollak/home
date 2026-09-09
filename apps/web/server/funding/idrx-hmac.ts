import { createHmac } from "node:crypto";

/**
 * IDRX request signature from the published TypeScript helper:
 * https://docs.idrx.co/api/generating-a-signature
 *
 * HMAC-SHA256(base64decode(secret), timestamp + method + url + body) → base64url
 *
 * The mint-request page also prints `METHOD:PATH:SHA256(body):timestamp`.
 * This client follows the Generating a Signature helper (and the processing-mint
 * examples that import it). Live-key smoke: if the dashboard key returns 401,
 * compare against that printed formula before changing this.
 */
export function createIdrxSignature(options: {
  method: string;
  url: string;
  body: string;
  timestamp: string;
  secretKey: string;
}): string {
  const hmac = createHmac("sha256", Buffer.from(options.secretKey, "base64"));
  hmac.update(options.timestamp);
  hmac.update(options.method);
  hmac.update(options.url);
  if (options.body.length > 0) hmac.update(options.body);
  return hmac.digest("base64url");
}

export function createIdrxRequestHeaders(options: {
  apiKey: string;
  secretKey: string;
  method: string;
  url: string;
  body: string;
  timestamp: string;
  userAgent?: string;
}): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": options.userAgent ?? "home/idrx-mint",
    "idrx-api-key": options.apiKey,
    "idrx-api-sig": createIdrxSignature({
      method: options.method,
      url: options.url,
      body: options.body,
      timestamp: options.timestamp,
      secretKey: options.secretKey,
    }),
    "idrx-api-ts": options.timestamp,
  };
}
