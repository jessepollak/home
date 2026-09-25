import "server-only";

export function getPaymasterUrl(configured: string | undefined = process.env.CDP_PAYMASTER_URL): string | null {
  try {
    const url = new URL(configured?.trim() ?? "");
    return url.protocol === "https:" && !url.username && !url.password && !url.hash ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isUsdcNetworkFeeEnabled(): boolean {
  return getPaymasterUrl() !== null;
}
