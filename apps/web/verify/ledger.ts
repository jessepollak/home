import { appendFile, chmod, mkdir, readFile, rm } from "node:fs/promises";
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

export async function withLedgerLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await ensureLedger(path);
  const lockPath = `${path}.lock`;
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Another verification run is reserving spend; confirmation was refused.");
    }
    throw error;
  }
  try {
    return await action();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
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

export type ArmComment = {
  html_url?: string;
  body?: string;
  user?: { login?: string };
};

export function armCommentId(by: string): string {
  const url = new URL(by);
  const match = `${url.pathname}${url.hash}`.match(/^\/jessepollak\/home\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !match) {
    throw new Error("--by must be a jessepollak/home issue or pull-request comment URL.");
  }
  return match[1];
}

export function armAuthorityError(surface: string, by: string, comment: ArmComment): string | null {
  armCommentId(by);
  if (comment.html_url !== by) return "The resolved GitHub comment URL does not match --by.";
  if (comment.user?.login !== "jessepollak") return "Only a comment authored by jessepollak can re-arm a surface.";
  if (comment.body?.trim() !== `/verify arm ${surface}`) return `The Jesse comment must contain exactly /verify arm ${surface}.`;
  return null;
}

export function armEvent(surface: string, by: string, comment: ArmComment, now = new Date()): LedgerArm {
  const authorityError = armAuthorityError(surface, by, comment);
  if (authorityError) throw new Error(authorityError);
  return { type: "arm", timestamp: now.toISOString(), surface, by };
}
