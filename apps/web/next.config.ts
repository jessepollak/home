import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@coinbase/cdp-sdk",
    "pg",
    "@vercel/otel",
  ],
  // Keep absolute development redirects intact instead of normalizing both
  // localhost and 127.0.0.1 to the same relative loopback URL.
  skipProxyUrlNormalize: process.env.NODE_ENV === "development",
  async headers() {
    return [{
      source: "/:path*",
      headers: [{
        key: "Content-Security-Policy",
        value: "frame-ancestors 'none'",
      }],
    }];
  },
};

export default nextConfig;
