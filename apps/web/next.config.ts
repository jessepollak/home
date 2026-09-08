import { resolve } from "node:path";
import type { NextConfig } from "next";

const hostedMoneyActionStore = Boolean(process.env.VERCEL || process.env.DATABASE_URL?.trim());

const nextConfig: NextConfig = {
  serverExternalPackages: ["@coinbase/cdp-sdk", "@neondatabase/serverless"],
  // Keep absolute development redirects intact instead of normalizing both
  // localhost and 127.0.0.1 to the same relative loopback URL.
  skipProxyUrlNormalize: process.env.NODE_ENV === "development",
  webpack: (config, { webpack }) => {
    if (hostedMoneyActionStore) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /server\/money-actions\/sqlite-store\.node$/,
          resolve(import.meta.dirname, "server/money-actions/sqlite-store.hosted-stub.ts"),
        ),
        new webpack.IgnorePlugin({ resourceRegExp: /^node:sqlite$/ }),
      );
    }
    return config;
  },
};

export default nextConfig;
