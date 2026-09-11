import type { NextConfig } from "next";

const hostedMoneyActionStore = Boolean(process.env.VERCEL || process.env.DATABASE_URL?.trim());

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@coinbase/cdp-sdk",
    "@neondatabase/serverless",
    "@vercel/otel",
  ],
  // Keep absolute development redirects intact instead of normalizing both
  // localhost and 127.0.0.1 to the same relative loopback URL.
  skipProxyUrlNormalize: process.env.NODE_ENV === "development",
  // Next.js 16 builds with Turbopack by default. On the hosted path, resolve
  // the local SQLite adapter to a stub so the serverless graph never loads
  // `node:sqlite`.
  turbopack: hostedMoneyActionStore
    ? {
        resolveAlias: {
          "./sqlite-store.node": "./server/money-actions/sqlite-store.hosted-stub.ts",
        },
      }
    : {},
};

export default nextConfig;
