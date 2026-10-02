import type { NextConfig } from "next";

// The performance job's attribution phase needs committed React render and commit
// timing, which only React's profiling client records. Next serves that client when
// reactProductionProfiling is set, so the attribution fixture is a separate build and
// the structural gates keep measuring the shipped bundle.
const reactProfiling = process.env.HOME_PERF_REACT_PROFILING === "1";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: { staleTimes: { dynamic: 300 } },
  ...(reactProfiling ? { reactProductionProfiling: true, distDir: ".next-profiling" } : {}),
  serverExternalPackages: [
    "@coinbase/cdp-sdk",
    "pg",
    "@vercel/otel",
  ],
  // Keep absolute development redirects intact instead of normalizing both
  // localhost and 127.0.0.1 to the same relative loopback URL.
  skipProxyUrlNormalize: process.env.NODE_ENV === "development",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
      ...["/asset-marks/:path*", "/currency-flags/:path*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      })),
    ];
  },
};

export default nextConfig;
