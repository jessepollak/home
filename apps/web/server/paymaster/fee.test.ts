import { describe, expect, test } from "bun:test";
import { decodeFunctionData, encodeAbiParameters, erc20Abi } from "viem";
import { COINBASE_SMART_WALLET_FACTORY_ADDRESS } from "@/server/actions/kinds/trade/signer";
import { TradePreparationError } from "@/server/actions/kinds/trade/permit2";
import type { TradeSignerResolver } from "@/shared/trading/server-types";
import { CoinbaseSmartAccountBatchSimulationError, encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionDraft } from "@/shared/money-actions/types";
import { NETWORK_FEE_ETH_UNFUNDED_MESSAGE, NETWORK_FEE_UNFUNDED_MESSAGE } from "@/shared/money-actions/network-fee";
import { createNetworkFeeService, makePaymasterApproval, NetworkFeeUnavailableError, NetworkFeeUnfundedError } from "./fee";
import { readTokenPayment } from "./fee";

const account = "0x1111111111111111111111111111111111111111" as const;
const calls = [{ to: "0x2222222222222222222222222222222222222222" as const, data: "0x1234" as const, value: "0" }];
const tokenPayment = { paymasterAndData: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c1234", tokenPayment: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, maxFee: "0x186a0", name: "USDC" } };
const session = { user: { subject: "fee-test" }, smartAccount: { address: account, chainId: 8453 }, accountProvider: "cdp-embedded" } as VerifiedAccountSession;
const draft: MoneyActionDraft = { kind: "send", title: "Send USDC", calls, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }], warnings: ["Your wallet will show the Base network fee before you sign."], expiresAt: new Date(Date.now() + 600000).toISOString() };

function service(options: { usdc?: bigint; eth?: bigint; quote?: unknown; throwQuote?: boolean; failUsdc?: boolean; failEth?: boolean; failCode?: boolean; enabled?: boolean; undeployed?: boolean; resolveSigner?: TradeSignerResolver } = {}) {
  const requested: string[] = [];
  let quotedOperation: Record<string, string> | undefined;
  let codeReads = 0;
  const client = { request: async (method: string, params: readonly unknown[]) => {
    requested.push(method);
    quotedOperation = params[0] as Record<string, string>;
    if (options.throwQuote) throw new Error("paymaster unavailable");
    return options.quote ?? tokenPayment;
  } } as never;
  const rpc = async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getCode") {
      codeReads += 1;
      if (options.failCode) throw new Error("code read failed");
      return options.undeployed ? "0x" : "0x1234";
    }
    if (method === "eth_call") {
      if (options.failUsdc && (params[0] as { to: string }).to.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") throw new Error("USDC read failed");
      return `0x${(options.usdc ?? BigInt(3000000)).toString(16).padStart(64, "0")}`;
    }
    if (method === "eth_getBalance") {
      if (options.failEth) throw new Error("ETH read failed");
      return `0x${(options.eth ?? BigInt(0)).toString(16)}`;
    }
    if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x3b9aca00" };
    if (method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
    throw new Error(method);
  };
  const fee = createNetworkFeeService({ rpc, estimator: { estimateBatch: async () => { if (options.undeployed) throw new CoinbaseSmartAccountBatchSimulationError("Unavailable", "account-capability"); return BigInt(100000); } }, client, enabled: () => options.enabled ?? true, resolveSigner: options.resolveSigner });
  return { fee, requested, getOperation: () => quotedOperation, getCodeReads: () => codeReads };
}

describe("USDC network fee quote", () => {
  test("encodes an approval before the action calls and parses the quoted max fee", async () => {
    const { fee, requested, getOperation } = service();
    const quote = await fee.quoteUsdcNetworkFee({ account, calls, usdcAvailableForFeeBaseUnits: BigInt(2000000) });
    expect(requested).toEqual(["pm_getPaymasterData"]);
    expect(getOperation()?.callData).toBe(encodeCoinbaseExecuteBatch([makePaymasterApproval(BigInt(2000000)), ...calls]));
    expect(quote).toEqual({ maxFeeBaseUnits: BigInt(100000), estimatedEthCostWei: BigInt(2160000000000000) });
  });
  test.each([{}, { paymasterAndData: "0x", tokenPayment: tokenPayment.tokenPayment }, { paymasterAndData: tokenPayment.paymasterAndData, tokenPayment: { ...tokenPayment.tokenPayment, address: account } }])("rejects sponsored and non-USDC responses", async (result) => {
    const { fee } = service({ quote: result });
    await expect(fee.quoteUsdcNetworkFee({ account, calls, usdcAvailableForFeeBaseUnits: BigInt(2000000) })).rejects.toThrow();
  });
  test("refuses a quote above the Max reserve so Max never under-reserves", async () => {
    const { fee } = service({ quote: { ...tokenPayment, tokenPayment: { ...tokenPayment.tokenPayment, maxFee: "0x186a1" } } });
    await expect(fee.quoteUsdcNetworkFee({ account, calls, usdcAvailableForFeeBaseUnits: BigInt(2000000) })).rejects.toThrow();
  });
  test("accepts tokenAddress and refuses a fee beyond five USDC", () => {
    expect(readTokenPayment({ paymasterAndData: tokenPayment.paymasterAndData, tokenPayment: { tokenAddress: tokenPayment.tokenPayment.address, decimals: 6, maxFee: "0x186a0" } })).toBe(BigInt(100000));
    expect(() => readTokenPayment({ paymasterAndData: tokenPayment.paymasterAndData, tokenPayment: { ...tokenPayment.tokenPayment, maxFee: "0x4c4b41" } })).toThrow();
    expect(() => readTokenPayment(tokenPayment, "0x0000000071727De22E5E9d8BAf0edAc6f37da032")).toThrow();
  });
});

describe("network fee choice", () => {
  test("USDC covers spend plus quote: first call approves the exact fee", async () => {
    const { fee, requested } = service({ usdc: BigInt(1100000), quote: { ...tokenPayment, tokenPayment: { ...tokenPayment.tokenPayment, maxFee: "0xca10" } } });
    const plan = await fee.applyNetworkFee(session, draft);
    expect(requested).toEqual(["pm_getPaymasterData"]);
    expect(plan.networkFee).toMatchObject({ payment: "usdc", maxFeeBaseUnits: "51728" });
    expect(decodeFunctionData({ abi: erc20Abi, data: plan.calls[0]!.data })).toMatchObject({ functionName: "approve", args: ["0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", BigInt(51728)] });
    expect(plan.calls[1]).toEqual(calls[0]);
    expect(plan.warnings).toEqual([]);
  });
  test("repay-all maximum covers estimated debt only once when choosing USDC", async () => {
    const repay = { ...draft, amounts: [
      { ...draft.amounts[0]!, amountBaseUnits: "1000000", estimated: true },
      { ...draft.amounts[0]!, amountBaseUnits: "1100000", maximum: true },
    ] };
    const { fee } = service({ usdc: BigInt(1200000) });
    expect((await fee.applyNetworkFee(session, repay)).networkFee).toMatchObject({ payment: "usdc", maxFeeBaseUnits: "100000" });
  });
  test("USDC short but ETH available falls back without approval", async () => {
    const { fee } = service({ usdc: BigInt(1000000), eth: BigInt(3000000000000000) });
    const plan = await fee.applyNetworkFee(session, draft);
    expect(plan.networkFee).toEqual({ payment: "native" });
    expect(plan.calls).toEqual(calls);
  });
  test("a quote above the Max reserve is refused: ETH covers it or prepare reports unavailable", async () => {
    const above = { ...tokenPayment, tokenPayment: { ...tokenPayment.tokenPayment, maxFee: "0x186a1" } };
    const funded = await service({ usdc: BigInt(3000000), eth: BigInt(3000000000000000), quote: above }).fee.applyNetworkFee(session, draft);
    expect(funded.networkFee).toEqual({ payment: "native" });
    expect(funded.calls).toEqual(calls);
    await expect(service({ usdc: BigInt(3000000), quote: above }).fee.applyNetworkFee(session, draft)).rejects.toBeInstanceOf(NetworkFeeUnavailableError);
  });
  test("ETH balance failure still permits a verified USDC quote", async () => {
    const { fee } = service({ failEth: true });
    expect((await fee.applyNetworkFee(session, draft)).networkFee).toMatchObject({ payment: "usdc" });
  });
  test("USDC balance failure still permits a verified native plan", async () => {
    const { fee, requested } = service({ failUsdc: true, eth: BigInt(3000000000000000) });
    expect((await fee.applyNetworkFee(session, draft)).networkFee).toEqual({ payment: "native" });
    expect(requested).toEqual([]);
  });
  test("failed balance reads without a verified plan report unavailable", async () => {
    for (const options of [{ failEth: true, usdc: BigInt(1000000) }, { failEth: true, failUsdc: true }, { failCode: true, usdc: BigInt(1000000), eth: BigInt(3000000000000000) }]) {
      await expect(service(options).fee.applyNetworkFee(session, draft)).rejects.toBeInstanceOf(NetworkFeeUnavailableError);
    }
  });
  test("a valid USDC quote reuses the deployment state read", async () => {
    const { fee, getCodeReads } = service();
    expect((await fee.applyNetworkFee(session, draft)).networkFee).toMatchObject({ payment: "usdc" });
    expect(getCodeReads()).toBe(1);
  });
  test("undeployed native fallback requires deployment verification gas", async () => {
    const deployedThreshold = (BigInt(2_000_000) + BigInt(450_000) + BigInt(120_000)) * BigInt(3_000_000_000);
    const deploymentThreshold = deployedThreshold + BigInt(300_000) * BigInt(3_000_000_000);
    await expect(service({ undeployed: true, usdc: BigInt(1000000), eth: deployedThreshold }).fee.applyNetworkFee(session, draft)).rejects.toMatchObject({ code: "NETWORK_FEE_UNFUNDED", message: NETWORK_FEE_UNFUNDED_MESSAGE });
    expect((await service({ undeployed: true, usdc: BigInt(1000000), eth: deploymentThreshold }).fee.applyNetworkFee(session, draft)).networkFee).toEqual({ payment: "native" });
  });
  test("counts canonical Base USDC spends before choosing the fee", async () => {
    const { fee } = service({ usdc: BigInt(1050000), eth: BigInt(3000000000000000) });
    const canonical = { ...draft, amounts: [{ ...draft.amounts[0]!, assetId: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }] };
    expect((await fee.applyNetworkFee(session, canonical)).networkFee).toEqual({ payment: "native" });
  });
  test("undeployed embedded account refuses a quote above its 0.50 USDC reserve", async () => {
    const resolveSigner: TradeSignerResolver = async () => ({ smartAccount: account, signerAddress: "0x3333333333333333333333333333333333333333", ownerIndex: 0, deployed: false });
    const { fee } = service({ undeployed: true, quote: { ...tokenPayment, tokenPayment: { ...tokenPayment.tokenPayment, maxFee: "0x7a121" } }, resolveSigner });
    await expect(fee.applyNetworkFee(session, draft, { request: new Request("https://home.test/api/actions/prepare") })).rejects.toBeInstanceOf(NetworkFeeUnavailableError);
  });
  test("undeployed embedded account accepts a 0.40 USDC quote with verified factory initCode and deployment gas", async () => {
    const owner = "0x3333333333333333333333333333333333333333";
    const request = new Request("https://home.test/api/actions/prepare");
    const { fee, requested, getOperation } = service({ undeployed: true, quote: { ...tokenPayment, tokenPayment: { ...tokenPayment.tokenPayment, maxFee: "0x61a80" } }, resolveSigner: async (input, verified) => {
      expect(input).toBe(request);
      expect(verified).toBe(session);
      return { smartAccount: account, signerAddress: owner, ownerIndex: 0, deployed: false };
    } });
    const plan = await fee.applyNetworkFee(session, draft, { request });
    expect(plan.networkFee).toMatchObject({ payment: "usdc", maxFeeBaseUnits: "400000" });
    expect(requested).toEqual(["pm_getPaymasterData"]);
    const operation = getOperation()!;
    expect(operation.initCode.slice(0, 42)).toBe(COINBASE_SMART_WALLET_FACTORY_ADDRESS);
    const create = decodeFunctionData({ abi: [{ type: "function", name: "createAccount", inputs: [{ name: "owners", type: "bytes[]" }, { name: "nonce", type: "uint256" }], outputs: [] }], data: `0x${operation.initCode.slice(42)}` });
    expect(create).toMatchObject({ functionName: "createAccount", args: [[encodeAbiParameters([{ type: "address" }], [owner])], BigInt(0)] });
    expect(BigInt(operation.verificationGasLimit)).toBe(BigInt(750000));
  });
  test("unsupported undeployed signers and Base Accounts retain native or unfunded fallback", async () => {
    const request = new Request("https://home.test/api/actions/prepare");
    const unsupportedSigner: TradeSignerResolver = async () => { throw new TradePreparationError("signer-unsupported"); };
    const { fee, requested } = service({ undeployed: true, eth: BigInt(9000000000000000), resolveSigner: unsupportedSigner });
    expect((await fee.applyNetworkFee(session, draft, { request })).networkFee).toEqual({ payment: "native" });
    expect((await fee.applyNetworkFee({ ...session, accountProvider: "base-account" }, draft, { request })).networkFee).toEqual({ payment: "native" });
    expect(requested).toEqual([]);
    const unfunded = service({ undeployed: true, resolveSigner: unsupportedSigner });
    await expect(unfunded.fee.applyNetworkFee(session, draft, { request })).rejects.toMatchObject({ code: "NETWORK_FEE_UNFUNDED", message: NETWORK_FEE_ETH_UNFUNDED_MESSAGE });
    await expect(unfunded.fee.applyNetworkFee({ ...session, accountProvider: "base-account" }, draft, { request })).rejects.toMatchObject({ code: "NETWORK_FEE_UNFUNDED", message: NETWORK_FEE_ETH_UNFUNDED_MESSAGE });
    await expect(service({ undeployed: true, usdc: BigInt(0) }).fee.applyNetworkFee({ ...session, accountProvider: "base-account" }, draft)).rejects.toMatchObject({ code: "NETWORK_FEE_UNFUNDED", message: NETWORK_FEE_ETH_UNFUNDED_MESSAGE });
  });
  test("transient undeployed signer failures report unavailable instead of asking for more funds", async () => {
    const request = new Request("https://home.test/api/actions/prepare");
    const failures: TradeSignerResolver[] = [
      async () => { throw new Error("token check failed"); },
      async () => { throw new TradePreparationError("provider-unavailable"); },
      async () => ({ smartAccount: account, signerAddress: "0x3333333333333333333333333333333333333333", ownerIndex: 0, deployed: true }),
    ];
    for (const resolveSigner of failures) {
      await expect(service({ undeployed: true, resolveSigner }).fee.applyNetworkFee(session, draft, { request })).rejects.toBeInstanceOf(NetworkFeeUnavailableError);
      expect((await service({ undeployed: true, eth: BigInt(9000000000000000), resolveSigner }).fee.applyNetworkFee(session, draft, { request })).networkFee).toEqual({ payment: "native" });
    }
  });
  test("eight action calls cannot add a USDC approval and ask for ETH when unfunded", async () => {
    const fullDraft = { ...draft, calls: Array.from({ length: 8 }, () => calls[0]!) };
    const { fee, requested } = service();
    await expect(fee.applyNetworkFee(session, fullDraft)).rejects.toMatchObject({ code: "NETWORK_FEE_UNFUNDED", message: NETWORK_FEE_ETH_UNFUNDED_MESSAGE });
    expect(requested).toEqual([]);
  });
  test("native fallback needs both call value and gas even when each is affordable separately", async () => {
    const valueCalls = [{ ...calls[0]!, value: "1000000000000000" }, { ...calls[0]!, value: "1000000000000000" }];
    const { fee } = service({ usdc: BigInt(1000000), eth: BigInt(3500000000000000) });
    await expect(fee.applyNetworkFee(session, { ...draft, calls: valueCalls })).rejects.toBeInstanceOf(NetworkFeeUnfundedError);
  });
  test("neither balance covers fee: unfunded", async () => {
    const { fee } = service({ usdc: BigInt(1000000), eth: BigInt(0) });
    await expect(fee.applyNetworkFee(session, draft)).rejects.toMatchObject({ code: "NETWORK_FEE_UNFUNDED", message: NETWORK_FEE_UNFUNDED_MESSAGE });
  });
  test("disabled: exact legacy draft", async () => {
    const { fee } = service({ enabled: false });
    expect(await fee.applyNetworkFee(session, draft)).toBe(draft);
  });
  test("quote errors never yield an unquoted USDC plan", async () => {
    const { fee } = service({ throwQuote: true, eth: BigInt(3000000000000000) });
    expect((await fee.applyNetworkFee(session, draft)).networkFee).toEqual({ payment: "native" });
  });
});
