import { SQL } from "bun";
import { startFork, startScratchPostgres } from "./infra";
import type { RunResult } from "./run";

const B20_STUB_CODE = "0x60206000f3";
export type Crashed = { seed: number; crashed: string };
export type WorkerOutput = { results: Array<RunResult | Crashed>; stubbed: string[]; upstream: "BASE_RPC_URL" | "public RPC" };

/** One isolated world: its own anvil fork and scratch Postgres, running the given seeds in order from one baseline. */
export async function simulateSeeds(seeds: number[], forkBlock: bigint, onProgress?: (done: number) => void): Promise<WorkerOutput> {
  const configured = process.env.BASE_RPC_URL?.trim();
  const pg = await startScratchPostgres();
  const fork = await startFork(configured || "https://mainnet.base.org", forkBlock).catch(async (error: unknown) => {
    await pg.stop();
    throw error;
  });
  // Home reads its chain and database only through these: point them at the fork and the scratch database.
  process.env.BASE_RPC_URL = fork.url;
  process.env.DATABASE_URL = pg.url;
  delete process.env.CDP_PAYMASTER_URL;
  delete process.env.BASE_ACCOUNT_STATUS_RPC_URL;
  const db = new SQL(pg.url);
  try {
    const { Chain } = await import("./chain");
    const { simulateRun, VirtualClock } = await import("./run");
    const { getBalancesUniverse } = await import("@/server/balances/universe");
    const chain = new Chain(fork.url);
    const [bundler] = await chain.rpc<`0x${string}`[]>("eth_accounts", []);
    if (!bundler) throw new Error("anvil exposed no accounts");
    await chain.rpc("anvil_setBlockTimestampInterval", [2]);
    const stubbed: string[] = [];
    for (const entry of (await getBalancesUniverse()).entries) {
      if (!entry.contractAddress) continue;
      try {
        await chain.rpc("eth_call", [{ to: entry.contractAddress, data: `0x70a08231${"0".repeat(64)}` }, "latest"]);
      } catch (error) {
        if (!String(error).includes("OpcodeNotFound")) throw error;
        await chain.rpc("anvil_setCode", [entry.contractAddress, B20_STUB_CODE]);
        stubbed.push(entry.id);
      }
    }
    await chain.mine(1);
    const clock = new VirtualClock(db);
    let baseline = await chain.snapshot();
    const results: WorkerOutput["results"] = [];
    for (const seed of seeds) {
      await chain.revert(baseline);
      baseline = await chain.snapshot();
      try {
        results.push(await simulateRun({ seed, chain, clock, db, bundler }));
      } catch (error) {
        results.push({ seed, crashed: String(error).split("\n")[0]!.slice(0, 200) });
      }
      onProgress?.(results.length);
    }
    return { results, stubbed, upstream: configured ? "BASE_RPC_URL" : "public RPC" };
  } finally {
    await db.close();
    await fork.stop();
    await pg.stop();
  }
}
