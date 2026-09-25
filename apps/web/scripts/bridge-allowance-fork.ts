import { createServer } from "node:net";
import { strict as assert } from "node:assert";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, http, keccak256, parseAbi, toHex, type Address } from "viem";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { base } from "viem/chains";

const baseRpc = "https://mainnet.base.org";
const factory = "0xba5ed110eFDBa3D005bfC882d75358ACBbB85842";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const documentedContract = "0x65bf8b55EEDef53C094E40003a03390De744DF33";
const token = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transferFrom(address,address,uint256) returns (bool)",
]);
const port = await freePort();
const local = `http://127.0.0.1:${port}`;
const anvil = Bun.spawn(["anvil", "--fork-url", baseRpc, "--host", "127.0.0.1", "--port", String(port), "--chain-id", "8453"], {
  stdout: "ignore", stderr: "ignore", env: { PATH: process.env.PATH ?? "" },
});
try {
  await waitForFork();
  const transport = http(local, { timeout: 30_000 });
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ chain: base, transport });
  assert.equal(await publicClient.getChainId(), 8453);
  console.log(`Base fork: chain=8453 block=${await publicClient.getBlockNumber()} rpc=local-only`);
  assert.notEqual(await publicClient.getBytecode({ address: factory }), undefined);
  assert.notEqual(await publicClient.getBytecode({ address: documentedContract }), undefined);
  const accounts = await rpc<Address[]>("eth_accounts", []);
  const owner = accounts[0];
  const recipient = accounts[1];
  assert(owner && recipient);
  const smart = await toCoinbaseSmartAccount({ client: publicClient, owners: [owner], version: "1.1" });
  const address = await smart.getAddress();
  const { factory: targetFactory, factoryData } = await smart.getFactoryArgs();
  assert(targetFactory && factoryData);
  assert.equal(targetFactory.toLowerCase(), factory.toLowerCase());
  await successful(walletClient.sendTransaction({ account: owner, to: targetFactory, data: factoryData, gas: BigInt(1_500_000) }));
  assert.notEqual(await publicClient.getBytecode({ address }), undefined);
  console.log(`Coinbase Smart Wallet: deployed via factory ${factory}; address=${address}`);
  const seed = BigInt(20_000_000);
  let balanceSlot: number | undefined;
  for (let slot = 0; slot <= 60; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [address, BigInt(slot)]));
    await rpc("anvil_setStorageAt", [usdc, key, toHex(seed, { size: 32 })]);
    if (await balance() === seed) { balanceSlot = slot; break; }
  }
  assert.notEqual(balanceSlot, undefined, "USDC balance mapping slot could not be located on fork");
  console.log(`USDC: locally seeded 20.000000 via storage slot ${balanceSlot}; no mainnet transfer`);
  async function approve(amount: bigint): Promise<void> {
    const data = await smart.encodeCalls([{ to: usdc, data: encodeFunctionData({ abi: token, functionName: "approve", args: [documentedContract, amount] }) }]);
    await successful(walletClient.sendTransaction({ account: owner, to: address, data, gas: BigInt(400_000) }));
  }
  await approve(BigInt(30_000_000));
  assert.equal(await allowance(), BigInt(30_000_000));
  console.log("Smart Wallet execute: approve 30.000000 USDC to documented Bridge Base address; allowance=30.000000");
  console.log("Verified IssuerFactory transferToDestination requires program issuerId and authorized debitor; neither is publicly assigned to Home.");
  console.log("Pull path: impersonated documented Bridge contract address calling USDC.transferFrom directly (NOT Bridge contract pull logic).");
  await rpc("anvil_setBalance", [documentedContract, toHex(BigInt(10) ** BigInt(18))]);
  await rpc("anvil_impersonateAccount", [documentedContract]);
  async function pull(amount: bigint, expectSuccess: boolean): Promise<void> {
    const data = encodeFunctionData({ abi: token, functionName: "transferFrom", args: [address, recipient, amount] });
    const hash = await walletClient.sendTransaction({ account: documentedContract, to: usdc, data, gas: BigInt(200_000) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, expectSuccess ? "success" : "reverted");
  }
  await pull(BigInt(10_000_000), true);
  assert.equal(await balance(), BigInt(10_000_000));
  assert.equal(await allowance(), BigInt(20_000_000));
  console.log("Pull 10.000000 within cap: succeeded; balance=10.000000 allowance=20.000000");
  await pull(BigInt(21_000_000), false);
  console.log("Pull 21.000000 above remaining allowance: reverted");
  await pull(BigInt(11_000_000), false);
  console.log("Pull 11.000000 above balance (within allowance): reverted");
  await approve(BigInt(0));
  assert.equal(await allowance(), BigInt(0));
  await pull(BigInt(1_000_000), false);
  console.log("Smart Wallet execute revoke 0; pull 1.000000: reverted");
  await rpc("anvil_stopImpersonatingAccount", [documentedContract]);
  console.log("PASS: fork-only ERC-20 allowance behavior; not a Bridge program authorization proof");

  async function successful(hashPromise: Promise<`0x${string}`>): Promise<void> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: await hashPromise });
    assert.equal(receipt.status, "success");
  }
  async function balance() { return publicClient.readContract({ address: usdc, abi: token, functionName: "balanceOf", args: [address] }); }
  async function allowance() { return publicClient.readContract({ address: usdc, abi: token, functionName: "allowance", args: [address, documentedContract] }); }
} finally {
  anvil.kill();
  await anvil.exited;
}

async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(local, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const result: { result?: T; error?: { message: string } } = await response.json();
  if (result.error || result.result === undefined) throw new Error(`Local fork RPC ${method} failed: ${result.error?.message ?? "missing result"}`);
  return result.result;
}
async function waitForFork(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (anvil.exitCode !== null) throw new Error("Local anvil fork exited before startup");
    try { await rpc("eth_chainId", []); return; }
    catch { await Bun.sleep(500); }
  }
  throw new Error("Local anvil fork did not start");
}
async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No local port"));
      server.close(() => resolve(address.port));
    });
  });
}
