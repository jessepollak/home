import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { readAllMigrationSql } from "@/tests/helpers/migrations";

export type ScratchPostgres = { url: string; stop(): Promise<void> };
export type Fork = { url: string; block: bigint; stop(): Promise<void> };

const WORLD_PREFIX = "home-money-sim-";
const OWNER_FILE = "owner.pid";
const ANVIL_FILE = "anvil.pid";
const liveStops = new Set<() => void>();
let hooked = false;

function stopAllNow() {
  for (const stop of [...liveStops]) {
    liveStops.delete(stop);
    stop();
  }
}

/**
 * Runs `stopNow` synchronously if this process exits or receives SIGINT, SIGTERM or SIGHUP before the returned
 * release is called, so an interrupted or crashed run leaves no scratch Postgres or anvil behind.
 */
export function stopWithProcess(stopNow: () => void): () => void {
  if (!hooked) {
    hooked = true;
    process.on("exit", stopAllNow);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(signal, () => {
        stopAllNow();
        process.exit(128 + constants.signals[signal]);
      });
    }
  }
  liveStops.add(stopNow);
  return () => void liveStops.delete(stopNow);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readPid(file: string): number | null {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function stopWorldNow(dir: string) {
  const data = join(dir, "data");
  if (existsSync(join(data, "postmaster.pid"))) {
    Bun.spawnSync(["pg_ctl", "-D", data, "-m", "immediate", "-w", "stop"], { stdout: "ignore", stderr: "ignore", env: { PATH: process.env.PATH ?? "" } });
  }
  const anvil = readPid(join(dir, ANVIL_FILE));
  if (anvil !== null && Bun.spawnSync(["ps", "-p", String(anvil), "-o", "comm="]).stdout.toString().includes("anvil")) {
    try {
      process.kill(anvil, "SIGKILL");
    } catch {}
  }
  rmSync(dir, { recursive: true, force: true });
}

/** Stops and removes every scratch Postgres and anvil whose owning process is gone, such as a killed worker's. */
export function reapOrphanedWorlds(): number {
  let reaped = 0;
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(WORLD_PREFIX)) continue;
    const dir = join(tmpdir(), name);
    const owner = readPid(join(dir, OWNER_FILE));
    if (owner === null || alive(owner)) continue;
    stopWorldNow(dir);
    reaped++;
  }
  return reaped;
}

export async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")));
    });
  });
}

async function run(command: string[], env: Record<string, string> = {}): Promise<void> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", ...env } });
  const code = await child.exited;
  if (code !== 0) {
    const stderr = await new Response(child.stderr).text();
    throw new Error(`${command[0]} exited ${code}: ${stderr.slice(0, 400)}`);
  }
}

export async function startScratchPostgres(): Promise<ScratchPostgres> {
  reapOrphanedWorlds();
  const dir = await mkdtemp(join(tmpdir(), `${WORLD_PREFIX}pg-`));
  await writeFile(join(dir, OWNER_FILE), String(process.pid));
  const release = stopWithProcess(() => stopWorldNow(dir));
  const data = join(dir, "data");
  const port = await freePort();
  const url = `postgres://sim@127.0.0.1:${port}/home_money_sim`;
  const stop = async () => {
    await run(["pg_ctl", "-D", data, "-m", "immediate", "-w", "stop"]).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
    release();
  };
  // Any failure while creating the scratch cluster closes its clients, stops it and removes its directory, then rethrows.
  const clients: SQL[] = [];
  try {
    await run(["initdb", "-D", data, "-U", "sim", "--auth=trust", "--no-sync", "-E", "UTF8"]);
    await run(["pg_ctl", "-D", data, "-l", join(dir, "postgres.log"), "-w", "-o",
      `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, "start"]);
    const admin = new SQL(`postgres://sim@127.0.0.1:${port}/postgres`);
    clients.push(admin);
    await admin.unsafe("CREATE DATABASE home_money_sim");
    const db = new SQL(url);
    clients.push(db);
    for (const migration of await readAllMigrationSql()) await db.unsafe(migration);
    // Virtual clock: Home's SQL `now()` resolves to this function first, so database time follows simulated chain time.
    await db.unsafe(`CREATE SCHEMA sim_clock;
      CREATE TABLE sim_clock.clock (at timestamptz NOT NULL);
      INSERT INTO sim_clock.clock VALUES (pg_catalog.now());
      CREATE FUNCTION sim_clock.now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT at FROM sim_clock.clock';
      ALTER DATABASE home_money_sim SET search_path TO sim_clock, pg_catalog, public;`);
  } catch (error) {
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
    await stop();
    throw error;
  }
  await Promise.all(clients.map((client) => client.close()));
  return { url, stop };
}

export async function startFork(upstream: string, block: bigint, reusePort?: number): Promise<Fork> {
  reapOrphanedWorlds();
  const port = reusePort ?? await freePort();
  const url = `http://127.0.0.1:${port}`;
  const dir = mkdtempSync(join(tmpdir(), `${WORLD_PREFIX}anvil-`));
  writeFileSync(join(dir, OWNER_FILE), String(process.pid));
  const anvil = Bun.spawn([
    "anvil", "--fork-url", upstream, "--fork-block-number", block.toString(), "--host", "127.0.0.1", "--port", String(port),
    "--chain-id", "8453", "--no-mining", "--silent", "--prune-history", "4096", "--accounts", "3", "--balance", "1000",
  ], { stdout: "ignore", stderr: "ignore", env: { PATH: process.env.PATH ?? "" } });
  writeFileSync(join(dir, ANVIL_FILE), String(anvil.pid));
  const release = stopWithProcess(() => stopWorldNow(dir));
  const discard = async () => {
    anvil.kill();
    await anvil.exited;
    await rm(dir, { recursive: true, force: true });
    release();
  };
  for (let attempt = 0; attempt < 120; attempt++) {
    if (anvil.exitCode !== null) {
      await discard();
      throw new Error("anvil exited before the fork was ready");
    }
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (response.ok) return { url, block, stop: discard };
    } catch {
      await Bun.sleep(250);
    }
  }
  await discard();
  throw new Error("anvil fork did not start");
}
