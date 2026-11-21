import {
  createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseAbi, toHex,
  type Address, type Hex, type PublicClient, type WalletClient,
} from "viem";
import { entryPoint06Abi, entryPoint06Address, getUserOperationHash, toCoinbaseSmartAccount, type UserOperation } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// Morpho Blue singleton: holds a large idle USDC float on Base, used only as the impersonated funding whale.
export const USDC_WHALE: Address = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
export const SAVE_VAULT: Address = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61";
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const vault = parseAbi(["function convertToAssets(uint256) view returns (uint256)"]);
const USER_OPERATION_EVENT = "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";

export type Call = { to: Address; data: Hex; value: string };
export type Landing = { transactionHash: Hex; blockNumber: bigint; blockHash: Hex; success: boolean };
export type DispatchMode = "normal" | "inner-revert" | "bundle-revert";
type Submission = { transactionHash: Hex; mode: DispatchMode; checked: boolean };
export type Dispatch = {
  actionId: string;
  userOpHash: Hex;
  callsKey: string;
  operation: UserOperation<"0.6">;
  submissions: Submission[];
  landing: Landing | null;
};

export class Chain {
  readonly client: PublicClient;
  readonly wallet: WalletClient;
  constructor(readonly url: string) {
    const transport = http(url, { timeout: 30_000, retryCount: 0 });
    this.client = createPublicClient({ chain: base, transport }) as PublicClient;
    this.wallet = createWalletClient({ chain: base, transport });
  }

  async rpc<T>(method: string, params: unknown[]): Promise<T> {
    return await this.client.request({ method: method as never, params: params as never }) as T;
  }

  async mine(blocks = 1): Promise<void> {
    await this.rpc("anvil_mine", [toHex(blocks)]);
  }

  async snapshot(): Promise<Hex> { return await this.rpc<Hex>("evm_snapshot", []); }
  async revert(id: Hex): Promise<void> {
    if (!await this.rpc<boolean>("evm_revert", [id])) throw new Error("evm_revert failed");
  }

  async usdcBalance(account: Address, blockNumber?: bigint): Promise<bigint> {
    return await this.client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account], blockNumber });
  }

  async vaultShares(account: Address, blockNumber?: bigint): Promise<bigint> {
    return await this.client.readContract({ address: SAVE_VAULT, abi: erc20, functionName: "balanceOf", args: [account], blockNumber });
  }

  async vaultAssets(shares: bigint, blockNumber?: bigint): Promise<bigint> {
    if (shares === BigInt(0)) return BigInt(0);
    return await this.client.readContract({ address: SAVE_VAULT, abi: vault, functionName: "convertToAssets", args: [shares], blockNumber });
  }

  async pendingTransactionCount(): Promise<number> {
    const block = await this.rpc<{ transactions: unknown[] } | null>("eth_getBlockByNumber", ["pending", false]);
    return block?.transactions.length ?? 0;
  }

  async fundUsdc(to: Address, amount: bigint): Promise<void> {
    await this.rpc("anvil_setBalance", [USDC_WHALE, toHex(BigInt(10) ** BigInt(18))]);
    await this.rpc("anvil_impersonateAccount", [USDC_WHALE]);
    await this.wallet.sendTransaction({
      account: USDC_WHALE, chain: base, to: USDC, gas: BigInt(120_000),
      data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [to, amount] }),
    });
    await this.rpc("anvil_stopImpersonatingAccount", [USDC_WHALE]);
  }
}

/**
 * Stand-in for the customer's CDP embedded wallet and the CDP bundler: a Coinbase Smart Wallet v1.1 owned by a
 * seeded test key, executing Home's confirmed calls as an EntryPoint v0.6 user operation submitted by a local EOA.
 */
export class SimWallet {
  private readonly dispatches = new Map<string, Dispatch>();
  private constructor(
    private readonly chain: Chain,
    private readonly account: Awaited<ReturnType<typeof toCoinbaseSmartAccount>>,
    readonly address: Address,
    private readonly bundler: Address,
  ) {}

  static async create(chain: Chain, seed: number, bundler: Address): Promise<SimWallet> {
    const owner = privateKeyToAccount(keccak256(toHex(`home-money-sim:${seed}`)));
    const account = await toCoinbaseSmartAccount({ client: chain.client, owners: [owner], version: "1.1" });
    const address = (await account.getAddress()).toLowerCase() as Address;
    const { factory, factoryData } = await account.getFactoryArgs();
    if (!factory || !factoryData) throw new Error("smart account factory args unavailable");
    await chain.wallet.sendTransaction({ account: bundler, chain: base, to: factory, data: factoryData, gas: BigInt(1_500_000) });
    await chain.rpc("anvil_setBalance", [address, toHex(BigInt(10) ** BigInt(18))]);
    return new SimWallet(chain, account, address, bundler);
  }

  all(): Dispatch[] { return [...this.dispatches.values()]; }
  get(actionId: string): Dispatch | undefined { return this.dispatches.get(actionId); }

  /** CDP `sendUserOperation({ idempotencyKey: id, calls })`: a replay with identical calls returns the same hash. */
  async dispatch(actionId: string, calls: Call[], mode: DispatchMode): Promise<{ kind: "sent"; userOpHash: Hex } | { kind: "idempotency-error" }> {
    const callsKey = JSON.stringify(calls.map((call) => [call.to.toLowerCase(), call.data.toLowerCase(), call.value]));
    const existing = this.dispatches.get(actionId);
    if (existing) return existing.callsKey === callsKey ? { kind: "sent", userOpHash: existing.userOpHash } : { kind: "idempotency-error" };
    const key = BigInt(keccak256(toHex(actionId))) >> BigInt(72);
    const block = await this.chain.client.getBlock({ blockTag: "latest" });
    const baseFee = block.baseFeePerGas ?? BigInt(1_000_000);
    const unsigned: UserOperation<"0.6"> = {
      sender: this.address,
      nonce: key << BigInt(64),
      initCode: "0x",
      callData: await this.account.encodeCalls(calls.map((call) => ({ to: call.to, data: call.data, value: BigInt(call.value) }))),
      callGasLimit: mode === "inner-revert" ? BigInt(22_000) : BigInt(1_500_000),
      verificationGasLimit: BigInt(400_000),
      preVerificationGas: BigInt(80_000),
      maxFeePerGas: baseFee * BigInt(3) + BigInt(1_000_000),
      maxPriorityFeePerGas: BigInt(1_000_000),
      paymasterAndData: "0x",
      signature: "0x",
    };
    const operation = { ...unsigned, signature: await this.account.signUserOperation(unsigned) };
    const userOpHash = getUserOperationHash({ chainId: 8453, entryPointAddress: entryPoint06Address, entryPointVersion: "0.6", userOperation: operation });
    const record: Dispatch = { actionId, userOpHash, callsKey, operation, submissions: [], landing: null };
    this.dispatches.set(actionId, record);
    await this.submit(record, mode);
    return { kind: "sent", userOpHash };
  }

  /** Bundler resubmission of an unlanded operation (the stand-in for CDP retrying a bundle that reverted). */
  async resubmitUnlanded(): Promise<number> {
    let count = 0;
    for (const record of this.dispatches.values()) {
      if (record.landing || record.submissions.some((s) => !s.checked)) continue;
      await this.submit(record, "normal");
      count += 1;
    }
    return count;
  }

  private async submit(record: Dispatch, mode: DispatchMode): Promise<void> {
    const transactionHash = await this.chain.wallet.writeContract({
      account: this.bundler, chain: base, address: entryPoint06Address, abi: entryPoint06Abi, functionName: "handleOps",
      args: [[{ ...record.operation, initCode: record.operation.initCode ?? "0x", paymasterAndData: record.operation.paymasterAndData ?? "0x" }], this.bundler], gas: mode === "bundle-revert" ? BigInt(90_000) : BigInt(3_000_000),
    });
    record.submissions.push({ transactionHash, mode, checked: false });
  }

  /** Ground truth: reads each submitted bundle receipt and its UserOperationEvent for the dispatched hash. */
  async observe(): Promise<void> {
    for (const record of this.dispatches.values()) {
      for (const submission of record.submissions) {
        if (submission.checked) continue;
        const receipt = await this.chain.client.getTransactionReceipt({ hash: submission.transactionHash }).catch(() => null);
        if (!receipt) continue;
        submission.checked = true;
        const event = receipt.logs.find((log) => log.address.toLowerCase() === entryPoint06Address.toLowerCase() &&
          log.topics[0]?.toLowerCase() === USER_OPERATION_EVENT && log.topics[1]?.toLowerCase() === record.userOpHash.toLowerCase());
        if (!event || record.landing) continue;
        const success = BigInt(`0x${event.data.slice(66, 130)}`) === BigInt(1);
        record.landing = { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, success };
      }
    }
  }
}
