import "server-only";

import { encodeAbiParameters, encodeFunctionData, erc20Abi } from "viem";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_USDC } from "@/shared/assets/base";
import { BASE_USDC_ADDRESS, BASE_USDC_PAYMASTER_ADDRESS, NETWORK_FEE_UNAVAILABLE_CODE, NETWORK_FEE_UNAVAILABLE_MESSAGE, NETWORK_FEE_UNFUNDED_CODE, NETWORK_FEE_UNFUNDED_MESSAGE, NETWORK_FEE_ETH_UNFUNDED_MESSAGE, usdcNetworkFeeReserveBaseUnits } from "@/shared/money-actions/network-fee";
import type { MoneyActionCall, MoneyActionDraft } from "@/shared/money-actions/types";
import { baseRpc, parseRpcDataWord, parseRpcQuantity, type BaseRpcOptions } from "@/server/chain/rpc";
import { applyCoinbaseBatchGasHeadroom, CoinbaseSmartAccountBatchSimulationError, encodeCoinbaseExecuteBatch, getBaseCoinbaseSmartAccountBatchEstimator, type CoinbaseSmartAccountBatchEstimator } from "@/server/chain/coinbase-smart-account";
import { createPaymasterClient, PaymasterError } from "./client";
import { isUsdcNetworkFeeEnabled } from "./config";
import { createTradeSignerResolver, COINBASE_SMART_WALLET_FACTORY_ADDRESS } from "@/server/actions/kinds/trade/signer";
import { TradePreparationError } from "@/server/actions/kinds/trade/permit2";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import type { TradeSignerResolver } from "@/shared/trading/server-types";

export const ENTRY_POINT_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as const;
const ENTRY_POINT_ABI = [{ type: "function", name: "getNonce", stateMutability: "view", inputs: [{ type: "address", name: "sender" }, { type: "uint192", name: "key" }], outputs: [{ type: "uint256" }] }] as const;
const VERIFICATION_GAS = BigInt(450_000);
const DEPLOYMENT_VERIFICATION_GAS = BigInt(300_000);
const FACTORY_ABI = [{ type: "function", name: "createAccount", stateMutability: "nonpayable", inputs: [{ name: "owners", type: "bytes[]" }, { name: "nonce", type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const PRE_VERIFICATION_GAS = BigInt(120_000);
const APPROVAL_GAS_ALLOWANCE = BigInt(60_000);
const MIN_PRIORITY_FEE = BigInt(1_000_000);
const MAX_USDC_FEE = BigInt(5_000_000);
const DUMMY_SIGNATURE = encodeAbiParameters([{ type: "tuple", components: [{ name: "ownerIndex", type: "uint8" }, { name: "signatureData", type: "bytes" }] }], [{ ownerIndex: 0, signatureData: `0x${"ff".repeat(32)}${"aa".repeat(32)}1c` }]);
const WARNING = "Your wallet will show the Base network fee before you sign.";

type Rpc = (method: string, params: readonly unknown[], options?: BaseRpcOptions) => Promise<unknown>;
type Client = ReturnType<typeof createPaymasterClient>;
type Dependencies = { rpc?: Rpc; estimator?: CoinbaseSmartAccountBatchEstimator; client?: Client; enabled?: () => boolean; resolveSigner?: TradeSignerResolver };

export class NetworkFeeUnfundedError extends Error {
  readonly code = NETWORK_FEE_UNFUNDED_CODE;
  constructor(asset: "usdc" | "eth" = "usdc") { super(asset === "eth" ? NETWORK_FEE_ETH_UNFUNDED_MESSAGE : NETWORK_FEE_UNFUNDED_MESSAGE); this.name = "NetworkFeeUnfundedError"; }
}
export class NetworkFeeUnavailableError extends Error {
  readonly code = NETWORK_FEE_UNAVAILABLE_CODE;
  constructor() { super(NETWORK_FEE_UNAVAILABLE_MESSAGE); this.name = "NetworkFeeUnavailableError"; }
}

export function makePaymasterApproval(amount: bigint): MoneyActionCall {
  return {
    to: BASE_USDC_ADDRESS,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [BASE_USDC_PAYMASTER_ADDRESS, amount] }),
    value: "0",
    approval: { assetId: BASE_USDC.id, spender: BASE_USDC_PAYMASTER_ADDRESS },
  };
}

export function readTokenPayment(value: unknown, entryPoint: string = ENTRY_POINT_V06): bigint {
  if (!isRecord(value) || !isRecord(value.tokenPayment)) throw new PaymasterError();
  const token = value.tokenPayment;
  const address = token.address ?? token.tokenAddress;
  if (typeof address !== "string" || address.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase() || token.decimals !== 6 || typeof token.maxFee !== "string" || !/^0x[0-9a-fA-F]+$/.test(token.maxFee)) throw new PaymasterError();
  if (entryPoint.toLowerCase() !== ENTRY_POINT_V06.toLowerCase() || typeof value.paymasterAndData !== "string" || !value.paymasterAndData.toLowerCase().startsWith(BASE_USDC_PAYMASTER_ADDRESS.toLowerCase())) throw new PaymasterError();
  const max = BigInt(token.maxFee);
  if (max === BigInt(0) || max > MAX_USDC_FEE) throw new PaymasterError();
  return max;
}

export function createNetworkFeeService(deps: Dependencies = {}) {
  const rpc = deps.rpc ?? baseRpc;
  const estimator = deps.estimator ?? getBaseCoinbaseSmartAccountBatchEstimator;
  const client = deps.client ?? createPaymasterClient();
  const resolveSigner = deps.resolveSigner ?? createTradeSignerResolver({ getValidator: () => getCdpAccessTokenValidator() });
  const read = (method: string, params: readonly unknown[], signal?: AbortSignal) => rpc(method, params, { signal });
  const gasPrice = async (signal?: AbortSignal) => {
    const block = await read("eth_getBlockByNumber", ["latest", false], signal);
    if (!isRecord(block)) throw new NetworkFeeUnavailableError();
    const baseFee = parseRpcQuantity(block.baseFeePerGas, "base fee");
    const priority = parseRpcQuantity(await read("eth_maxPriorityFeePerGas", [], signal), "priority fee");
    const maxPriorityFeePerGas = priority > MIN_PRIORITY_FEE ? priority : MIN_PRIORITY_FEE;
    return { maxPriorityFeePerGas, maxFeePerGas: BigInt(2) * baseFee + maxPriorityFeePerGas };
  };
  const ethCost = async (account: `0x${string}`, calls: MoneyActionCall[], signal?: AbortSignal, callGasLimit?: bigint) => {
    let raw: bigint;
    if (callGasLimit !== undefined) {
      raw = callGasLimit + BigInt(calls.filter(call => call.approval).length) * APPROVAL_GAS_ALLOWANCE;
    } else {
      try { raw = await estimator.estimateBatch(calls, account, signal); }
      catch (error) {
        if (!(error instanceof CoinbaseSmartAccountBatchSimulationError) || error.code !== "account-capability") throw error;
        raw = BigInt(2_000_000);
      }
    }
    const limit = applyCoinbaseBatchGasHeadroom(raw);
    if (limit === null) throw new NetworkFeeUnavailableError();
    return { limit, ...await gasPrice(signal) };
  };
  const quote = async (input: { account: `0x${string}`; calls: MoneyActionCall[]; usdcAvailableForFeeBaseUnits: bigint; deploymentCode?: string; session?: VerifiedAccountSession; request?: Request; signal?: AbortSignal; callGasLimit?: bigint }) => {
    const { account, calls, usdcAvailableForFeeBaseUnits: available, deploymentCode, session, request, signal, callGasLimit } = input;
    const code = deploymentCode ?? await read("eth_getCode", [account, "latest"], signal);
    if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) throw new NetworkFeeUnavailableError();
    let initCode = "0x";
    let verificationGas = VERIFICATION_GAS;
    if (code === "0x") {
      if (session?.accountProvider !== "cdp-embedded" || !request) return null;
      let signer: Awaited<ReturnType<TradeSignerResolver>>;
      try { signer = await resolveSigner(request, session, signal); }
      catch (error) {
        if (error instanceof TradePreparationError && error.reason === "signer-unsupported") return null;
        throw new NetworkFeeUnavailableError();
      }
      if (signer.deployed) throw new NetworkFeeUnavailableError();
      if (signer.smartAccount.toLowerCase() !== account.toLowerCase() || signer.ownerIndex !== 0 || !/^0x[0-9a-fA-F]{40}$/.test(signer.signerAddress)) return null;
      const owner = encodeAbiParameters([{ type: "address" }], [signer.signerAddress]);
      initCode = `${COINBASE_SMART_WALLET_FACTORY_ADDRESS}${encodeFunctionData({ abi: FACTORY_ABI, functionName: "createAccount", args: [[owner], BigInt(0)] }).slice(2)}`;
      verificationGas += DEPLOYMENT_VERIFICATION_GAS;
    }
    const nonce = parseRpcDataWord(await read("eth_call", [{ to: ENTRY_POINT_V06, data: encodeFunctionData({ abi: ENTRY_POINT_ABI, functionName: "getNonce", args: [account, BigInt(0)] }) }, "latest"], signal), "nonce");
    const feeCalls = [makePaymasterApproval(available), ...calls];
    const { limit, maxFeePerGas, maxPriorityFeePerGas } = await ethCost(account, feeCalls, signal, callGasLimit);
    const operation = {
      sender: account,
      nonce: `0x${nonce.toString(16)}`,
      initCode,
      callData: encodeCoinbaseExecuteBatch(feeCalls),
      callGasLimit: `0x${limit.toString(16)}`,
      verificationGasLimit: `0x${verificationGas.toString(16)}`,
      preVerificationGas: `0x${PRE_VERIFICATION_GAS.toString(16)}`,
      maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
      maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
      paymasterAndData: "0x",
      signature: DUMMY_SIGNATURE,
    };
    const params = [operation, ENTRY_POINT_V06, "0x2105"];
    const result = await client.request("pm_getPaymasterData", params, signal);
    const maxFeeBaseUnits = readTokenPayment(result);
    if (maxFeeBaseUnits > BigInt(usdcNetworkFeeReserveBaseUnits(code !== "0x"))) throw new PaymasterError();
    return { maxFeeBaseUnits, estimatedEthCostWei: (limit + verificationGas + PRE_VERIFICATION_GAS) * maxFeePerGas };
  };
  const apply = async (session: VerifiedAccountSession, draft: MoneyActionDraft, options: { signal?: AbortSignal; request?: Request; callGasLimit?: bigint } = {}): Promise<MoneyActionDraft> => {
    const { signal, request } = options;
    const callGasLimit = draft.kind === "trade" ? options.callGasLimit : undefined;
    if (!(deps.enabled ?? isUsdcNetworkFeeEnabled)()) return draft;
    if (!session.smartAccount) throw new NetworkFeeUnavailableError();
    const account = session.smartAccount.address;
    const [usdcRead, ethRead, codeRead] = await Promise.allSettled([
      read("eth_call", [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [account] }) }, "latest"], signal).then(value => parseRpcDataWord(value, "USDC balance")),
      read("eth_getBalance", [account, "latest"], signal).then(value => parseRpcQuantity(value, "ETH balance")),
      read("eth_getCode", [account, "latest"], signal).then(value => {
        if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new NetworkFeeUnavailableError();
        return value;
      }),
    ]);
    const usdcSpends = draft.amounts.filter(amount => amount.direction === "spend" && (amount.assetId === BASE_USDC.id || amount.assetId === BASE_USDC.fundingId || amount.assetId.toLowerCase() === `eip155:8453/erc20:${BASE_USDC_ADDRESS.toLowerCase()}`));
    const hasMaximum = usdcSpends.some(amount => amount.maximum === true);
    const spent = usdcSpends.filter(amount => !hasMaximum || amount.estimated !== true).reduce((sum, amount) => sum + BigInt(amount.amountBaseUnits), BigInt(0));
    const usdc = usdcRead.status === "fulfilled" ? usdcRead.value : BigInt(0);
    const available = usdc > spent ? usdc - spent : BigInt(0);
    let quoted: Awaited<ReturnType<typeof quote>> = null;
    let quoteFailed = usdcRead.status === "rejected";
    let usdcPathUnavailable = draft.calls.length >= 8 || (codeRead.status === "fulfilled" && codeRead.value === "0x" && session.accountProvider === "base-account");
    if (available > BigInt(0) && draft.calls.length < 8 && codeRead.status === "fulfilled") {
      try {
        quoted = await quote({ account, calls: draft.calls, usdcAvailableForFeeBaseUnits: available, deploymentCode: codeRead.value, session, request, signal, callGasLimit });
        if (quoted === null) usdcPathUnavailable = true;
      } catch { quoteFailed = true; }
    }
    if (quoted && quoted.maxFeeBaseUnits <= available) {
      return {
        ...draft,
        calls: [makePaymasterApproval(quoted.maxFeeBaseUnits), ...draft.calls],
        warnings: draft.warnings.filter(warning => warning !== WARNING),
        networkFee: { payment: "usdc", token: BASE_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: quoted.maxFeeBaseUnits.toString(), decimals: 6 },
      };
    }
    if (ethRead.status === "rejected" || codeRead.status === "rejected") throw new NetworkFeeUnavailableError();
    const eth = ethRead.value;
    if (eth === BigInt(0) && !quoteFailed) throw new NetworkFeeUnfundedError(usdcPathUnavailable ? "eth" : "usdc");
    try {
      const { limit, maxFeePerGas } = await ethCost(account, draft.calls, signal, callGasLimit);
      const nativeValue = draft.calls.reduce((sum, call) => sum + BigInt(call.value), BigInt(0));
      const verificationGas = VERIFICATION_GAS + (codeRead.value === "0x" ? DEPLOYMENT_VERIFICATION_GAS : BigInt(0));
      if (eth >= (limit + verificationGas + PRE_VERIFICATION_GAS) * maxFeePerGas + nativeValue) return { ...draft, networkFee: { payment: "native" } };
    } catch { throw new NetworkFeeUnavailableError(); }
    if (quoteFailed) throw new NetworkFeeUnavailableError();
    throw new NetworkFeeUnfundedError(usdcPathUnavailable ? "eth" : "usdc");
  };
  return { quoteUsdcNetworkFee: quote, applyNetworkFee: apply };
}

export const { quoteUsdcNetworkFee, applyNetworkFee } = createNetworkFeeService();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
