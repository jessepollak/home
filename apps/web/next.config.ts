import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@coinbase/cdp-sdk", "@neondatabase/serverless"],
  // Keep absolute development redirects intact instead of normalizing both
  // localhost and 127.0.0.1 to the same relative loopback URL.
  skipProxyUrlNormalize: process.env.NODE_ENV === "development",
};

export default nextConfig;
