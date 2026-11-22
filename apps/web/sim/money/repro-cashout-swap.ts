import { SQL } from "bun";
import { startFork, startScratchPostgres } from "./infra";

/**
 * Smallest repro of the swapped cash-out link (round-2 seed 126): two identical Peer cash-outs, both prepared before
 * either confirms, whose deposits land one at a time while neither action has a transaction hash yet. Each hashless
 * action is linked by inference to the only matching deposit it can see; once both hashes and finalized outcomes are
 * in, each action is still linked to the other's deposit.
 */
export async function reproCashoutSwap(forkBlock: bigint, landFirst: "A" | "B"): Promise<{ reproduced: boolean; lines: string[] }> {
  const configured = process.env.BASE_RPC_URL?.trim();
  const pg = await startScratchPostgres();
  const fork = await startFork(configured || "https://mainnet.base.org", forkBlock).catch(async (error: unknown) => {
    await pg.stop();
    throw error;
  });
  process.env.BASE_RPC_URL = fork.url;
  process.env.DATABASE_URL = pg.url;
  process.env.PEER_OFFRAMP_ENABLED = "1";
  delete process.env.PEER_OFFRAMP_MODE;
  delete process.env.CDP_PAYMASTER_URL;
  const db = new SQL(pg.url);
  const lines: string[] = [];
  try {
    const { Chain, SimWallet } = await import("./chain");
    const { HomeOwner } = await import("./home");
    const { VirtualClock } = await import("./run");
    const { PeerStandIn, guardPeerNetwork } = await import("./peer");
    const chain = new Chain(fork.url, forkBlock);
    const peer = new PeerStandIn(chain);
    peer.install();
    guardPeerNetwork();
    const clock = new VirtualClock(db);
    const mine = async (blocks: number) => { await chain.mine(blocks); await clock.syncTo(chain); };
    await chain.rpc("anvil_setBlockTimestampInterval", [2]);
    const [bundler] = await chain.rpc<`0x${string}`[]>("eth_accounts", []);
    await clock.syncTo(chain);
    const wallet = await SimWallet.create(chain, 126, bundler!);
    await chain.fundUsdc(wallet.address, BigInt(100_000_000));
    await mine(1);
    const home = new HomeOwner("sim-repro-126", wallet.address);
    const params = { providerId: "peer", region: "US", assetId: "base:usdc", amountBaseUnits: "10000000", platform: "cashapp", currency: "USD", payoutHandle: "$homesimalpha" };

    // 1. Both prepared before either confirms, so the prepare-time guard lets both through.
    const a = String((await home.prepare("cash-out", params)).body.id);
    const b = String((await home.prepare("cash-out", params)).body.id);
    const calls = { A: (await home.confirm(a)).body.calls, B: (await home.confirm(b)).body.calls };
    const ids = { A: a, B: b };
    const second = landFirst === "A" ? "B" : "A";
    // 2. One deposit lands while both actions are hashless; an owner read infers a link to the only deposit visible.
    const first = await wallet.dispatch(ids[landFirst], calls[landFirst] as never, "normal");
    await mine(1);
    await home.list();
    // 3. The other deposit lands; the next read links the remaining hashless action to it.
    const later = await wallet.dispatch(ids[second], calls[second] as never, "normal");
    await mine(1);
    await home.list();
    // 4. Both handles and transaction hashes arrive, both outcomes finalize, and Home reads again.
    await wallet.observe();
    for (const [key, dispatch] of [[landFirst, first], [second, later]] as const) {
      if (dispatch.kind !== "sent") throw new Error("dispatch failed");
      await home.handle(ids[key], { providerHandle: dispatch.userOpHash });
      await home.handle(ids[key], { transactionHash: wallet.get(ids[key])!.landing!.transactionHash });
    }
    for (let round = 0; round < 3; round++) {
      await mine(70);
      await home.drainScheduled();
      await home.webhook();
      await home.list();
    }

    const orders = await peer.orders(wallet.address);
    const rows = await db<Array<{ action_id: string; deposit_id: string | null; deposit_proven: boolean }>>`
      SELECT action_id, deposit_id, deposit_proven FROM cashout_orders WHERE action_id IN (${a}, ${b})`;
    const outcomes = await db<Array<{ id: string; outcome: string | null; transaction_hash: string | null }>>`
      SELECT id, outcome, transaction_hash FROM actions WHERE id IN (${a}, ${b})`;
    let reproduced = true;
    for (const key of ["A", "B"] as const) {
      const id = ids[key];
      const own = orders.find((order) => order.transactionHash === wallet.get(id)?.landing?.transactionHash.toLowerCase());
      const link = rows.find((row) => String(row.action_id) === id);
      const action = outcomes.find((row) => String(row.id) === id);
      const swapped = Boolean(own && link?.deposit_id && link.deposit_id.toLowerCase() !== own.depositId.toLowerCase());
      if (!swapped || action?.outcome !== "succeeded" || !action.transaction_hash) reproduced = false;
      lines.push(`cash-out ${key} ${id.slice(0, 8)}: outcome ${action?.outcome ?? "none"}, hash ${action?.transaction_hash ? "recorded" : "missing"}, ` +
        `own receipt deposit ${own?.depositId.slice(-5) ?? "none"}, Home link ${link?.deposit_id?.slice(-5) ?? "none"} ` +
        `(${link?.deposit_proven ? "proven" : "inferred"})${swapped ? "  <- swapped" : ""}`);
    }
    return { reproduced, lines };
  } finally {
    await db.close();
    await fork.stop();
    await pg.stop();
  }
}
