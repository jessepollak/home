import { createHash, createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const HOME_SESSION_SECRET = "playwright-smoke-home-session-secret-32-bytes!!";
const ADDRESS = "0x1111111111111111111111111111111111111111";

function signedHomeSessionCookie(): string {
  const issuedAt = new Date();
  const payload = JSON.stringify({
    version: 1,
    session: {
      user: {
        subject: `base-${createHash("sha256").update(ADDRESS).digest("hex").slice(0, 32)}`,
      },
      smartAccount: { address: ADDRESS, chainId: 8453 },
      accountProvider: "base-account",
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
  });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const input = `v1.${encoded}`;
  const signature = createHmac("sha256", HOME_SESSION_SECRET)
    .update(input)
    .digest("base64url");
  return `home-session=${input}.${signature}`;
}

test("signed landing requests use canonical route redirects", async ({ request }) => {
  const headers = { cookie: signedHomeSessionCookie() };

  const root = await request.get("/", { headers, maxRedirects: 0 });
  expect(root.status()).toBe(307);
  expect(root.headers().location).toBe("/home");

  const overlay = await request.get(
    "/?flow=send&panel=balances&group=investments",
    { headers, maxRedirects: 0 },
  );
  expect(overlay.status()).toBe(307);
  expect(overlay.headers().location).toBe("/home?flow=send");

  const signIn = await request.get("/?account=signin", {
    headers,
    maxRedirects: 0,
  });
  expect(signIn.status()).toBe(200);

  const legacy = await request.get(
    "/dashboard?panel=balances&group=investments",
    { headers, maxRedirects: 0 },
  );
  expect(legacy.status()).toBe(307);
  expect(legacy.headers().location).toBe("/home");
});
