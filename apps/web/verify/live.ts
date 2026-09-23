import { relative, resolve } from "node:path";

export const liveProviderOrigins = [
  "https://secure-wallet.cdp.coinbase.com",
  "https://api.cdp.coinbase.com",
];

export const bareHostnamePattern = /^(?=.{1,253}$)(?:localhost|(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)\.)*(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))$/;

export function composeAllowedDomains(baseUrl: URL, additionalDomains: string[], fixtureMode: boolean): string[] {
  const normalized = additionalDomains.map((domain) => {
    if (!bareHostnamePattern.test(domain)) throw new Error(`--allow-domain must be a bare hostname, received “${domain}”.`);
    return domain.toLowerCase();
  });
  return [...new Set([baseUrl.hostname.toLowerCase(), ...liveProviderOrigins.map((origin) => new URL(origin).hostname),
    ...normalized, ...(fixtureMode ? ["localhost", "127.0.0.1"] : [])])];
}

export function unexpectedNetworkHosts(urls: string[], allowedHosts: string[]): string[] {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  const observed = urls.flatMap((value) => {
    try { return [new URL(value).hostname.toLowerCase()]; }
    catch { return []; }
  });
  return [...new Set(observed.filter((host) => !allowed.has(host)))].sort();
}

export function hostObservationRefusal(hosts: string[]): string | null {
  return hosts.length ? `Unexpected network hosts were observed: ${hosts.join(", ")}.` : null;
}

export function automationEnvironmentError(env: Record<string, string | undefined>): string | null {
  return env.CI || env.GITHUB_ACTIONS ? "Live verification cannot run in CI or GitHub Actions." : null;
}

export function outputInsideRepository(output: string, repositoryRoot: string): boolean {
  const relation = relative(resolve(repositoryRoot), resolve(output));
  return relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"));
}
