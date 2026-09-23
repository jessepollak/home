import { appendFile, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type VerifyRole } from "./policy";

export type LedgerRun = {
  type: "run";
  timestamp: string;
  runId: string;
  host: string;
  surface: string;
  role: VerifyRole;
  mainRevision: string;
  rungReached: 0 | 1 | 2 | 3;
  confirmCount?: number;
  actionIds?: string[];
  amountsUsd?: number[];
  incidents: string[];
  clean: boolean;
};

export type LedgerEntry = LedgerRun;

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

export type LedgerLockOptions = {
  beforeStaleLockRemoval?: () => Promise<void> | void;
};

function reservationRefusal(lockPath: string): Error {
  return new Error(`Another verification run is reserving a confirmation; confirmation was refused. If no verification run is active, remove ${lockPath} (rm -rf ${lockPath}) and retry.`);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function lockOwner(lockPath: string): Promise<{ pid?: number; timestamp?: number } | null> {
  try {
    return JSON.parse(await readFile(resolve(lockPath, "owner.json"), "utf8")) as { pid?: number; timestamp?: number };
  } catch {
    return null;
  }
}

async function clearStaleLock(lockPath: string, options: LedgerLockOptions): Promise<boolean> {
  const owner = await lockOwner(lockPath);
  if (!owner || typeof owner.pid !== "number" || typeof owner.timestamp !== "number") return false;
  if (Date.now() - owner.timestamp <= staleLockMilliseconds) return false;
  if (processIsAlive(owner.pid)) return false;
  await options.beforeStaleLockRemoval?.();
  const quarantinePath = `${lockPath}.stale-${crypto.randomUUID()}`;
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const movedOwner = await lockOwner(quarantinePath);
  if (!movedOwner || movedOwner.pid !== owner.pid || movedOwner.timestamp !== owner.timestamp) {
    try {
      await rename(quarantinePath, lockPath);
    } catch {
      console.error(`Could not restore the newer verification lock at ${lockPath}; it remains at ${quarantinePath}.`);
    }
    return false;
  }
  await rm(quarantinePath, { recursive: true, force: true });
  console.error(`Removed a stale verification lock at ${lockPath} left by process ${owner.pid}.`);
  return true;
}

export async function withLedgerLock<T>(path: string, action: () => Promise<T>, options: LedgerLockOptions = {}): Promise<T> {
  await ensureLedger(path);
  const lockPath = `${path}.lock`;
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await clearStaleLock(lockPath, options))) throw reservationRefusal(lockPath);
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
        return JSON.parse(line) as { type?: string };
      } catch {
        throw new Error(`Invalid verification ledger entry on line ${index + 1}.`);
      }
    }).filter((entry): entry is LedgerEntry => entry.type === "run");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function confirmsForDay(entries: LedgerEntry[], date: string): number {
  return entries.reduce((total, entry) => entry.timestamp.startsWith(date)
    ? total + (entry.confirmCount ?? entry.amountsUsd?.length ?? 0)
    : total, 0);
}

export function confirmsForRun(entries: LedgerEntry[], runId: string): number {
  return entries.reduce((total, entry) => entry.runId === runId
    ? total + (entry.confirmCount ?? entry.amountsUsd?.length ?? 0)
    : total, 0);
}
