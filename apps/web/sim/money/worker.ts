import { SQL } from "bun";
import { startFork, startScratchPostgres } from "./infra";
import type { RunResult } from "./run";

const B20_STUB_CODE = "0x60206000f3";
export type Crashed = { seed: number; crashed: string };
export type WorkerOutput = {
  results: Array<RunResult | Crashed>; stubbed: string[]; upstream: "BASE_RPC_URL" | "public RPC"; retried: number[]; peerRequestsRefused: number;
};

/**
 * One isolated world: its own anvil fork and scratch Postgres, running the given seeds in order from one baseline.
 * A run that throws (an infrastructure error, not an invariant violation) is retried once from the baseline, after
 * restarting the fork on the same port if it died; a second throw is reported as a crash.
 */
export async function simulateSeeds(seeds: number[], forkBlock: bigint, onProgress?: (done: number) => void): Promise<WorkerOutput> {
  const configured = process.env.BASE_RPC_URL?.trim();
  const upstream = configured || "https://mainnet.base.org";
  const pg = await startScratchPostgres();
  let fork = await startFork(upstream, forkBlock).catch(async (error: unknown) => {
    await pg.stop();
    throw error;
  });
  const port = Number(new URL(fork.url).port);
  // Home reads its chain and database only through these: point them at the fork and the scratch database.
  process.env.BASE_RPC_URL = fork.url;
  process.env.DATABASE_URL = pg.url;
  delete process.env.CDP_PAYMASTER_URL;
  delete process.env.BASE_ACCOUNT_STATUS_RPC_URL;
  // The US Peer corridor, production contracts on the fork; Peer's offchain services are the stand-in in ./peer.
  process.env.PEER_OFFRAMP_ENABLED = "1";
  delete process.env.PEER_OFFRAMP_MODE;
  const db = new SQL(pg.url);
  const results: WorkerOutput["results"] = [];
  const retried: number[] = [];
  let stubbed: string[] = [];
  let peerGuard: { refused: () => number } | null = null;
  try {
    const { Chain } = await import("./chain");
    const { simulateRun, VirtualClock } = await import("./run");
    const { getBalancesUniverse } = await import("@/server/balances/universe");
    const { PeerStandIn, guardPeerNetwork } = await import("./peer");
    const chain = new Chain(fork.url, forkBlock);
    const peer = new PeerStandIn(chain);
    peer.install();
    peerGuard = guardPeerNetwork();
    const clock = new VirtualClock(db);
    const [bundler] = await chain.rpc<`0x${string}`[]>("eth_accounts", []);
    if (!bundler) throw new Error("anvil exposed no accounts");
    const prepareWorld = async () => {
      await chain.rpc("anvil_setBlockTimestampInterval", [2]);
      stubbed = [];
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
      return await chain.snapshot();
    };
    const restartIfDead = async () => {
      if (await chain.rpc("eth_chainId", []).then(() => true, () => false)) return false;
      await fork.stop();
      fork = await startFork(upstream, forkBlock, port);
      return true;
    };
    let baseline = await prepareWorld();
    for (const seed of seeds) {
      let outcome: RunResult | Crashed | null = null;
      for (let attempt = 0; attempt < 2 && !outcome; attempt++) {
        try {
          if (attempt > 0) {
            retried.push(seed);
            await db`DELETE FROM actions WHERE owner_key LIKE ${`["sim-${seed}",%`}`;
            if (await restartIfDead()) baseline = await prepareWorld();
            else await chain.rpc("anvil_dropAllTransactions", []);
          }
          await chain.revert(baseline);
          baseline = await chain.snapshot();
          outcome = await simulateRun({ seed, chain, clock, db, bundler, peer });
        } catch (error) {
          if (attempt === 1) outcome = { seed, crashed: String(error).split("\n")[0]!.slice(0, 200) };
        }
      }
      results.push(outcome!);
      onProgress?.(results.length);
    }
  } catch (error) {
    const crashed = String(error).split("\n")[0]!.slice(0, 200);
    for (const seed of seeds.slice(results.length)) results.push({ seed, crashed: `world failed: ${crashed}` });
  } finally {
    await db.close();
    await fork.stop();
    await pg.stop();
  }
  return { results, stubbed, upstream: configured ? "BASE_RPC_URL" : "public RPC", retried, peerRequestsRefused: peerGuard?.refused() ?? 0 };
}
