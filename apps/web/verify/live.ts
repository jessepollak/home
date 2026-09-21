import { relative, resolve } from "node:path";
import type { LiveAccess } from "./map";

export const confirmLabelPattern = /confirm|approve|sign|submit|pay|deposit|withdraw|send now|cash out/i;
export const accountPattern = /^0x[0-9a-fA-F]{40}$/;
export const liveProviderOrigins = [
  "https://api.cdp.coinbase.com",
  "https://secure-wallet.cdp.coinbase.com",
] as const;

const bareHostnamePattern = /^(?=.{1,253}$)(?:localhost|(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)\.)*(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))$/;

export function composeAllowedDomains(
  baseUrl: URL,
  additionalDomains: string[],
  fixtureMode: boolean,
): string[] {
  const normalizedAdditional = additionalDomains.map((domain) => {
    if (!bareHostnamePattern.test(domain)) {
      throw new Error(`--allow-domain must be a bare hostname, received “${domain}”.`);
    }
    return domain.toLowerCase();
  });
  const providerDomains = liveProviderOrigins.map((origin) => new URL(origin).hostname);
  const fixtureDomains = fixtureMode ? ["localhost", "127.0.0.1"] : [];
  return [...new Set([baseUrl.hostname.toLowerCase(), ...providerDomains, ...normalizedAdditional, ...fixtureDomains])];
}

export type ConfirmGateDecision =
  | { action: "run" }
  | { action: "stop"; reason: string }
  | { action: "refuse"; reason: string };

export function decideConfirmGate(
  live: LiveAccess | undefined,
  stepLabel: string,
  allowConfirm: boolean,
): ConfirmGateDecision {
  const access = live ?? "read-only";
  if (allowConfirm && access !== "confirm") {
    return { action: "refuse", reason: `--allow-confirm is not available for a ${access} surface.` };
  }
  if (!confirmLabelPattern.test(stepLabel)) return { action: "run" };
  if (access === "confirm" && allowConfirm) return { action: "run" };
  return { action: "stop", reason: `Live ${access} verification stops before “${stepLabel}”.` };
}

export function parseUsdAmount(text: string): number | null {
  const lines = reviewLines(text);
  const labelled = ["Amount", "You pay"];
  for (const label of labelled) {
    const index = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
    if (index !== -1) {
      const parsed = parseUsdToken(lines[index + 1] ?? "");
      if (parsed !== null) return parsed;
    }
  }
  for (const line of lines.slice(0, 4)) {
    const parsed = parseUsdToken(line);
    if (parsed !== null) return parsed;
  }
  return null;
}

export type BorrowReviewAmounts = {
  borrowedAmount: string | null;
  collateralAmount: string | null;
  borrowedAmountUsd: number | null;
};

export function parseBorrowReviewAmounts(text: string): BorrowReviewAmounts {
  const lines = reviewLines(text);
  const borrowedAmount = valueAfterLabel(lines, /^You receive(?:\s|\()/i) ??
    lines.find((line) => parseUsdStablecoinToken(line) !== null) ?? null;
  const collateralAmount = valueAfterLabel(lines, /^Locked as collateral(?:\s|\()/i);
  return {
    borrowedAmount,
    collateralAmount,
    borrowedAmountUsd: borrowedAmount === null ? null : parseUsdStablecoinToken(borrowedAmount),
  };
}

function reviewLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function valueAfterLabel(lines: string[], label: RegExp): string | null {
  const index = lines.findIndex((line) => label.test(line));
  return index === -1 ? null : lines[index + 1] ?? null;
}

function parseUsdStablecoinToken(value: string): number | null {
  const match = value.match(/^(?:Estimated\s+)?(?:Up to\s+)?([0-9][0-9,]*(?:\.[0-9]+)?)\s+(?:USDC|USD)$/i);
  if (!match) return parseUsdToken(value);
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function parseUsdToken(value: string): number | null {
  const match = value.match(/(?:^|\s)(?:US\$|USD\s*|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s|$)/i);
  if (!match) return null;
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function enforceAmountCap(amount: number | null, cap: number): string | null {
  if (amount === null) return "The review amount could not be parsed as USD; confirmation was refused.";
  if (!Number.isFinite(cap) || cap <= 0) return "--max-usd must be a positive number.";
  if (amount > cap) return `The review amount $${amount.toFixed(2)} exceeds the $${cap.toFixed(2)} cap.`;
  return null;
}

export function accountPinError(observed: string | null, pinned: string): string | null {
  if (!observed || !accountPattern.test(observed)) return "The signed-in account address could not be read from the Account surface.";
  if (!accountPattern.test(pinned)) return "The stored test-account pin is invalid; run verify live-login again.";
  if (observed.toLowerCase() !== pinned.toLowerCase()) {
    return `The signed-in account ${observed} does not match the pinned test account ${pinned}.`;
  }
  return null;
}

export function automationEnvironmentError(env: Record<string, string | undefined>): string | null {
  return env.CI || env.GITHUB_ACTIONS ? "Live verification is operator-only and cannot run in CI or GitHub Actions." : null;
}

export function outputInsideRepository(output: string, repositoryRoot: string): boolean {
  const relation = relative(resolve(repositoryRoot), resolve(output));
  return relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"));
}
