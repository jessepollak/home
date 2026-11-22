import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { readAllMigrationSql } from "@/tests/helpers/migrations";

export type ScratchPostgres = { url: string; stop(): Promise<void> };
export type Fork = { url: string; block: bigint; stop(): Promise<void> };

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
  const dir = await mkdtemp(join(tmpdir(), "home-money-sim-pg-"));
  const data = join(dir, "data");
  const port = await freePort();
  const url = `postgres://sim@127.0.0.1:${port}/home_money_sim`;
  const stop = async () => {
    await run(["pg_ctl", "-D", data, "-m", "immediate", "-w", "stop"]).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
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
  const port = reusePort ?? await freePort();
  const url = `http://127.0.0.1:${port}`;
  const anvil = Bun.spawn([
    "anvil", "--fork-url", upstream, "--fork-block-number", block.toString(), "--host", "127.0.0.1", "--port", String(port),
    "--chain-id", "8453", "--no-mining", "--silent", "--prune-history", "4096", "--accounts", "3", "--balance", "1000",
  ], { stdout: "ignore", stderr: "ignore", env: { PATH: process.env.PATH ?? "" } });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (anvil.exitCode !== null) throw new Error("anvil exited before the fork was ready");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (response.ok) return { url, block, async stop() { anvil.kill(); await anvil.exited; } };
    } catch {
      await Bun.sleep(250);
    }
  }
  anvil.kill();
  throw new Error("anvil fork did not start");
}
