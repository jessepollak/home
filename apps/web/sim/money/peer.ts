import { CASH_ATTRIBUTION_CODE, createCashClient, type CashOrder } from "@zkp2p/cash";
import { BASE_BUILDER_CODE, Zkp2pClient } from "@zkp2p/sdk";
import { createWalletClient, decodeEventLog, decodeFunctionData, encodeFunctionData, http, keccak256, parseAbi, toHex, type Hex, type Log } from "viem";
import { entryPoint06Abi } from "viem/account-abstraction";
import { base } from "viem/chains";
import { resolveBaseRpcUrl } from "@/server/chain/rpc";
import { setPeerClientFactoryForTests } from "@/server/funding/providers/peer/offramp";
import { PEER_CREATE_DEPOSIT_ABI, PEER_ESCROW_ABI, PEER_WITHDRAW_ABI } from "@/server/funding/providers/peer/abi";
import {
  PEER_CURATOR_PRODUCTION_ORIGIN, PEER_INDEXER_ENDPOINT, PEER_PRODUCTION_CONTRACTS,
} from "@/server/funding/providers/peer/manifest";
import type { Chain } from "./chain";

const EXECUTE_BATCH_ABI = parseAbi(["function executeBatch((address target,uint256 value,bytes data)[] calls)"]);
const ESCROW = PEER_PRODUCTION_CONTRACTS.escrow.toLowerCase() as `0x${string}`;
type Payee = { platform: string; currency: string };
export type SimOrder = CashOrder & { depositor: string; transactionHash: string };
const ATTRIBUTION_SUFFIX = attributionSuffix([CASH_ATTRIBUTION_CODE, BASE_BUILDER_CODE]);
const PEER_ORIGIN = /^https:\/\/(?:[a-z0-9-]+\.)*zkp2p\.xyz\//;

/** Refuses every request to a Peer origin, so no simulated cash-out reaches Peer's real services. */
export function guardPeerNetwork(): { refused: () => number } {
  let refused = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (PEER_ORIGIN.test(url)) { refused += 1; return new Response("{}", { status: 503 }); }
    return await realFetch(input, init);
  }, realFetch);
  return { refused: () => refused };
}

function attributionSuffix(codes: readonly string[]): Hex {
  const bytes = new TextEncoder().encode(codes.join(","));
  const codesHex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${codesHex}${bytes.length.toString(16).padStart(2, "0")}00${"8021".repeat(8)}`;
}

/**
 * Stand-in for Peer's offchain legs. Home's real Peer SDK clients run against the fork for everything onchain
 * (deposit and withdraw calldata, the escrow contract, receipts). Three offchain services are replaced:
 * the curator's payee registration (a deterministic hash per platform and handle), the indexer (deposit state read
 * straight from the fork's escrow events, with no lag), and buyer fills (none: every deposit waits for a buyer
 * until it is withdrawn). The SDK's own indexer reads (withdraw preparation and fill-time statistics) are replaced
 * too: withdraw calldata is `withdrawDeposit(id)` with Peer's attribution suffix, which Home's boundary check then
 * verifies, and fill statistics are refused by the fetch guard, so the ETA reads unknown.
 */
export class PeerStandIn {
  private readonly payees = new Map<string, Payee>();

  constructor(private readonly chain: Chain) {}

  install(): void {
    setPeerClientFactoryForTests(() => {
      const rpcTransport = http(resolveBaseRpcUrl(), { timeout: 6_000 });
      const cash = createCashClient({
        environment: "production", transport: rpcTransport, curatorUrl: PEER_CURATOR_PRODUCTION_ORIGIN,
        indexerUrl: PEER_INDEXER_ENDPOINT, features: {},
      });
      const sdk = new Zkp2pClient({
        walletClient: createWalletClient({ chain: base, transport: rpcTransport }), chainId: 8453, runtimeEnv: "production",
        rpcTransport, baseApiUrl: PEER_CURATOR_PRODUCTION_ORIGIN, indexerUrl: PEER_INDEXER_ENDPOINT, timeouts: { api: 6_000 },
      });
      Object.assign(sdk, {
        registerPayeeDetails: async (input: { processorNames: string[]; payeeData: Array<{ offchainId: string }> }) => ({
          hashedOnchainIds: input.processorNames.map((platform, index) => this.registerPayee(platform, input.payeeData[index]!.offchainId)),
        }),
      });
      Object.assign(cash, {
        orders: async (owner: string, options?: { inFlight?: boolean }) => {
          const orders = await this.orders(owner);
          return options?.inFlight ? orders.filter((order) => order.state !== "returned" && order.state !== "delivered") : orders;
        },
        prepareWithdraw: async (depositId: string) => {
          const number = BigInt(depositId.slice(depositId.lastIndexOf("_") + 1));
          const data = `${encodeFunctionData({ abi: PEER_WITHDRAW_ABI, functionName: "withdrawDeposit", args: [number] })}${ATTRIBUTION_SUFFIX.slice(2)}` as Hex;
          return { txs: [{ to: ESCROW, data, value: BigInt(0) }], steps: [] };
        },
        order: async (depositId: string) => {
          const found = (await this.allOrders()).find((order) => order.depositId.toLowerCase() === depositId.toLowerCase());
          if (!found) throw new Error(`No deposit found for id ${depositId}.`);
          return found;
        },
      });
      return { environment: "production", cash, sdk };
    });
  }

  private registerPayee(platform: string, handle: string): Hex {
    const hash = keccak256(toHex(`peer-payee:${platform}:${handle}`));
    // Currency is fixed per corridor; the sim uses the US corridor, so every payee pays out in USD.
    this.payees.set(hash.toLowerCase(), { platform, currency: "USD" });
    return hash;
  }

  async orders(owner: string): Promise<SimOrder[]> {
    return (await this.allOrders()).filter((order) => order.depositor === owner.toLowerCase());
  }

  /** The indexer stand-in: every escrow deposit on the fork, rebuilt from its events and creating calldata. */
  async allOrders(): Promise<SimOrder[]> {
    const logs = await this.chain.client.getLogs({ address: ESCROW, fromBlock: this.chain.forkBlock, toBlock: "latest" });
    const deposits = new Map<string, SimOrder>();
    for (const log of logs) {
      let decoded;
      try { decoded = decodeEventLog({ abi: PEER_ESCROW_ABI, data: log.data, topics: log.topics as Log["topics"], strict: true }); } catch { continue; }
      const block = await this.chain.client.getBlock({ blockHash: log.blockHash! });
      if (decoded.eventName === "DepositReceived") {
        const id = `${ESCROW}_${decoded.args.depositId.toString(10)}`;
        const payee = await this.payeeFor(log.transactionHash!, decoded.args.amount);
        deposits.set(id, {
          depositId: id, depositor: decoded.args.depositor.toLowerCase(), transactionHash: log.transactionHash!.toLowerCase(), state: "awaiting-buyer", fills: [],
          totalAmount: decoded.args.amount, filledAmount: BigInt(0), pendingAmount: BigInt(0), returnedAmount: BigInt(0),
          nextActions: ["withdraw"], updatedAt: Number(block.timestamp), intentCount: 0,
          payouts: payee ? [{ platform: payee.platform, currency: payee.currency, payeeHash: payee.hash } as never] : [],
        } as unknown as SimOrder);
      } else if (decoded.eventName === "DepositWithdrawn") {
        const deposit = deposits.get(`${ESCROW}_${decoded.args.depositId.toString(10)}`);
        if (!deposit) continue;
        deposit.returnedAmount += decoded.args.amount;
        deposit.updatedAt = Number(block.timestamp);
        if (deposit.returnedAmount >= deposit.totalAmount) { deposit.state = "returned"; deposit.nextActions = []; }
      }
    }
    return [...deposits.values()];
  }

  private async payeeFor(transactionHash: Hex, amount: bigint): Promise<(Payee & { hash: Hex }) | null> {
    const transaction = await this.chain.client.getTransaction({ hash: transactionHash });
    const { args } = decodeFunctionData({ abi: entryPoint06Abi, data: transaction.input });
    for (const operation of (args?.[0] ?? []) as unknown as Array<{ callData: Hex }>) {
      let batch;
      try { batch = decodeFunctionData({ abi: EXECUTE_BATCH_ABI, data: operation.callData }); } catch { continue; }
      for (const call of batch.args[0]) {
        if (call.target.toLowerCase() !== ESCROW) continue;
        const params = decodeFunctionData({ abi: PEER_CREATE_DEPOSIT_ABI, data: call.data }).args[0] as
          { amount: bigint; paymentMethodData: readonly { payeeDetails: Hex }[] };
        const hash = params.paymentMethodData[0]?.payeeDetails;
        const payee = hash ? this.payees.get(hash.toLowerCase()) : undefined;
        if (payee && params.amount === amount) return { ...payee, hash: hash! };
      }
    }
    return null;
  }
}
