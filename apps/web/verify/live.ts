import { relative, resolve } from "node:path";
import { matchesConfirmLabel, type LiveAccess, type ReachStep } from "./map";

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
  isConfirmLabel = false,
  afterReview = false,
): ConfirmGateDecision {
  const access = live ?? "read-only";
  if (allowConfirm && access !== "confirm") {
    return { action: "refuse", reason: `--allow-confirm is not available for a ${access} surface.` };
  }
  if (isConfirmLabel) {
    if (access === "confirm" && allowConfirm) return { action: "run" };
    return { action: "stop", reason: `Live ${access} verification stops before “${stepLabel}”.` };
  }
  if (afterReview && (access === "confirm" || access === "up-to-review") && !isReviewNavigationLabel(stepLabel)) {
    return { action: "stop", reason: `Live ${access} verification stopped before unknown review control “${stepLabel}”.` };
  }
  return { action: "run" };
}

export function isReviewNavigationLabel(label: string): boolean {
  return label === "Continue" || label === "Back" || label === "Close" || label.startsWith("Close ");
}

export function confirmReviewOrderError(steps: ReachStep[], confirmLabels: string[]): string | null {
  for (const [index, step] of steps.entries()) {
    if (step.kind !== "click" || !matchesConfirmLabel(confirmLabels, step.label)) continue;
    const previous = steps[index - 1];
    if (previous?.kind !== "expect" || !/^(?:Confirm|Review)/i.test(previous.text)) {
      return `Live confirmation refuses “${step.label}” unless a Confirm or Review expect step immediately precedes it.`;
    }
  }
  return null;
}

export function liveStepError(live: LiveAccess | undefined, step: ReachStep, approvedSteps: ReachStep[]): string | null {
  if (live !== "confirm" && live !== "up-to-review") return null;
  if (step.kind === "press") return `Live ${live} verification refuses press steps before browser launch.`;
  if (step.kind === "fill") {
    const approved = approvedSteps.some((candidate) => candidate.kind === "fill" && candidate.label === step.label);
    if (!approved) return `Live ${live} verification refuses fill for unlisted field “${step.label}”.`;
  }
  return null;
}

export function parseUsdAmount(text: string): number | null {
  const amounts = distinctUsdAmounts(text);
  return amounts.length === 1 ? amounts[0] : null;
}

export function parseUsdAmountFromLabel(label: string): number | null {
  const amounts = distinctUsdAmounts(label);
  return amounts.length === 1 ? amounts[0] : null;
}

export function reviewAndLabelAmountError(reviewAmount: number | null, labelAmount: number | null): string | null {
  if (reviewAmount === null) return "The review must contain exactly one distinct USD amount; confirmation was refused.";
  if (labelAmount !== null && labelAmount !== reviewAmount) {
    return `The review amount $${reviewAmount.toFixed(2)} does not match the confirm label amount $${labelAmount.toFixed(2)}.`;
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
  const borrowedAmount = valueAfterLabel(lines, /^You receive\s*\((?:USDC|USD)\)$/i);
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

function distinctUsdAmounts(value: string): number[] {
  const amounts = [...value.matchAll(/(?:^|\s)(?:US\$|USD\s*|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?=\s|$)/gim)]
    .map((match) => Number(match[1].replaceAll(",", "")))
    .filter((amount) => Number.isFinite(amount) && amount >= 0);
  return [...new Set(amounts)];
}

function parseUsdToken(value: string): number | null {
  const amounts = distinctUsdAmounts(value);
  return amounts.length === 1 ? amounts[0] : null;
}

export function unexpectedNetworkHosts(urls: string[], allowedHosts: string[]): string[] {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  const observed = urls.flatMap((value) => {
    try {
      return [new URL(value).hostname.toLowerCase()];
    } catch {
      return [];
    }
  });
  return [...new Set(observed.filter((host) => !allowed.has(host)))].sort();
}

export function hostObservationRefusal(unexpectedHosts: string[]): string | null {
  return unexpectedHosts.length > 0
    ? `Unexpected network hosts were observed: ${unexpectedHosts.join(", ")}.`
    : null;
}

export function enforceAmountCap(amount: number | null, cap: number): string | null {
  if (amount === null) return "The review amount could not be parsed as USD; confirmation was refused.";
  if (!Number.isFinite(cap) || cap <= 0) return "--max-usd must be a positive number.";
  if (amount > cap) return `The review amount $${amount.toFixed(2)} exceeds the $${cap.toFixed(2)} cap.`;
  return null;
}

export function enforceCumulativeAmountCap(confirmed: number, next: number, cap: number): string | null {
  const total = confirmed + next;
  if (!Number.isFinite(cap) || cap <= 0) return "--max-usd-total must be a positive number.";
  if (total > cap) return `The cumulative confirmation amount $${total.toFixed(2)} exceeds the $${cap.toFixed(2)} run cap.`;
  return null;
}

export function accountAddressFromDocument(source: Document): string | null {
  const heading = source.getElementById("account-heading");
  const section = heading?.closest("section");
  const values = [...(section?.querySelectorAll("button[title]") ?? [])].map((node) => node.getAttribute("title"));
  return values.find((value) => /^0x[0-9a-fA-F]{40}$/.test(value ?? "")) ?? null;
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
