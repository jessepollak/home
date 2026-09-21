import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { verifyPolicy, type VerifyRole } from "./policy";

export type LedgerRun = {
  type: "run";
  timestamp: string;
  runId: string;
  host: string;
  surface: string;
  role: VerifyRole;
  mainRevision: string;
  rungReached: 0 | 1 | 2 | 3;
  amountsUsd: number[];
  incidents: string[];
  clean: boolean;
};

export type LedgerArm = {
  type: "arm";
  timestamp: string;
  surface: string;
  by: string;
};

export type LedgerDisarm = {
  type: "disarm";
  timestamp: string;
  surface: string;
  incidents: string[];
  runId: string;
};

export type LedgerEntry = LedgerRun | LedgerArm | LedgerDisarm;

export type SurfaceArmState = {
  armed: boolean;
  cleanRuns: number;
  reason: "clean-runs" | "jesse-arm" | "incident" | "insufficient-clean-runs";
};

export async function ensureLedger(path: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await appendFile(path, "", { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function appendLedger(path: string, entry: LedgerEntry): Promise<void> {
  await ensureLedger(path);
  await appendFile(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

export async function readLedger(path: string): Promise<LedgerEntry[]> {
  try {
    const contents = await readFile(path, "utf8");
    return contents.split("\n").filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line) as LedgerEntry;
      } catch {
        throw new Error(`Invalid verification ledger entry on line ${index + 1}.`);
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function surfaceArmState(
  entries: LedgerEntry[],
  surface: string,
  mainRevision: string,
): SurfaceArmState {
  const relevantEvents = entries.filter((entry) => entry.surface === surface && entry.type !== "run");
  const lastEvent = relevantEvents.at(-1);
  if (lastEvent?.type === "arm") return { armed: true, cleanRuns: 0, reason: "jesse-arm" };
  if (lastEvent?.type === "disarm") return { armed: false, cleanRuns: 0, reason: "incident" };
  const cleanRuns = entries.filter((entry): entry is LedgerRun =>
    entry.type === "run" &&
    entry.surface === surface &&
    entry.mainRevision === mainRevision &&
    entry.rungReached >= 2 &&
    entry.clean &&
    entry.incidents.length === 0
  ).length;
  return cleanRuns >= verifyPolicy.cleanRunsToArm
    ? { armed: true, cleanRuns, reason: "clean-runs" }
    : { armed: false, cleanRuns, reason: "insufficient-clean-runs" };
}

export function spendForDay(entries: LedgerEntry[], date: string, role: VerifyRole = "factory"): number {
  return entries.reduce((total, entry) => {
    if (entry.type !== "run" || entry.role !== role || !entry.timestamp.startsWith(date)) return total;
    return total + entry.amountsUsd.reduce((sum, amount) => sum + amount, 0);
  }, 0);
}

export function spendForRun(entries: LedgerEntry[], runId: string): number {
  return entries.reduce((total, entry) => {
    if (entry.type !== "run" || entry.runId !== runId) return total;
    return total + entry.amountsUsd.reduce((sum, amount) => sum + amount, 0);
  }, 0);
}

export function armEvent(surface: string, by: string, now = new Date()): LedgerArm {
  const url = new URL(by);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !/\/(issues|pull)\/\d+#issuecomment-\d+$/.test(url.pathname + url.hash)) {
    throw new Error("--by must be a GitHub issue or pull-request comment URL.");
  }
  return { type: "arm", timestamp: now.toISOString(), surface, by: url.toString() };
}
