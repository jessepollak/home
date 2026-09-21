import { appendFile, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  commentId: string;
  createdAt: string;
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

const staleLockMilliseconds = 10 * 60 * 1000;

function reservationRefusal(lockPath: string): Error {
  return new Error(`Another verification run is reserving spend; confirmation was refused. If no verification run is active, remove ${lockPath} (rm -rf ${lockPath}) and retry.`);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function clearStaleLock(lockPath: string): Promise<boolean> {
  let owner: { pid?: number; timestamp?: number };
  try {
    owner = JSON.parse(await readFile(resolve(lockPath, "owner.json"), "utf8")) as { pid?: number; timestamp?: number };
  } catch {
    return false;
  }
  if (typeof owner.pid !== "number" || typeof owner.timestamp !== "number") return false;
  if (Date.now() - owner.timestamp <= staleLockMilliseconds) return false;
  if (processIsAlive(owner.pid)) return false;
  await rm(lockPath, { recursive: true, force: true });
  console.error(`Removed a stale verification lock at ${lockPath} left by process ${owner.pid}.`);
  return true;
}

export async function withLedgerLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await ensureLedger(path);
  const lockPath = `${path}.lock`;
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await clearStaleLock(lockPath))) throw reservationRefusal(lockPath);
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code !== "EEXIST") throw retryError;
      throw reservationRefusal(lockPath);
    }
  }
  try {
    await writeFile(resolve(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, timestamp: Date.now() }), { mode: 0o600 });
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
  host: string,
): SurfaceArmState {
  const relevantEvents = entries.filter((entry) =>
    entry.surface === surface && (entry.type !== "run" || entry.incidents.length > 0)
  );
  const lastEvent = relevantEvents.at(-1);
  if (lastEvent?.type === "arm") return { armed: true, cleanRuns: 0, reason: "jesse-arm" };
  if (lastEvent?.type === "disarm" || lastEvent?.type === "run") return { armed: false, cleanRuns: 0, reason: "incident" };
  const cleanRuns = entries.filter((entry): entry is LedgerRun =>
    entry.type === "run" &&
    entry.surface === surface &&
    entry.host === host &&
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
  created_at?: string;
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
  if (!comment.created_at || !Number.isFinite(Date.parse(comment.created_at))) return "The resolved Jesse comment has no readable creation time.";
  return null;
}

export function armReplayError(entries: LedgerEntry[], surface: string, commentId: string, createdAt: string): string | null {
  if (entries.some((entry) => entry.type === "arm" && entry.commentId === commentId)) {
    return "That comment already re-armed a surface; comment again to re-arm.";
  }
  const latestDisarm = entries.filter((entry): entry is LedgerDisarm => entry.type === "disarm" && entry.surface === surface).at(-1);
  if (latestDisarm && Date.parse(createdAt) <= Date.parse(latestDisarm.timestamp)) {
    return `That comment predates the latest ${surface} disarm; comment again to re-arm.`;
  }
  return null;
}

export function armEvent(surface: string, by: string, comment: ArmComment, now = new Date()): LedgerArm {
  const authorityError = armAuthorityError(surface, by, comment);
  if (authorityError) throw new Error(authorityError);
  const createdAt = comment.created_at ?? "";
  return { type: "arm", timestamp: now.toISOString(), surface, by, commentId: armCommentId(by), createdAt };
}
