import { encodeFunctionData, parseAbi } from "viem";
import { portfolioVaults, PORTFOLIO_USDC_ADDRESS } from "../../../config/portfolio-assets";
import type { PreparedMoneyAction, SavingsMoneyActionMetadata } from "../../../shared/money-actions/types";
import { BASE_USDC_PAYMASTER_ADDRESS } from "../../../shared/money-actions/network-fee";
import { sessionBody } from "../fixtures/bodies";

const fixtureCreatedAt = "2026-09-10T12:03:00.000Z";
const fixtureExpiresAt = "2099-09-10T12:03:00.000Z";
const fixtureBlockTimestamp = "1789041780";
export const savingsFixtureActionIds = {
  deposit: "22222222-2222-4222-8222-222222222221",
  withdraw: "22222222-2222-4222-8222-222222222222",
} as const;
const adapter = "0xb98c948cfa24072e58935bc004a8a7b376ae746a" as const;
const bundler = "0x6bfd8137e702540e7a42b74178a4a49ba43920c4" as const;
const adapterAbi = parseAbi([
  "function erc20TransferFrom(address token, address receiver, uint256 amount)",
  "function erc4626Deposit(address vault, uint256 assets, uint256 maxSharePriceE27, address receiver)",
]);
const bundlerAbi = parseAbi(["function multicall((address to, bytes data, uint256 value, bool skipRevert, bytes32 callbackHash)[] bundle) payable"]);

export function savingsPrepareFixture({
  operation,
  vaultAddress = portfolioVaults[0].address,
  amountBaseUnits = "100000",
}: {
  operation: "deposit" | "withdraw";
  vaultAddress?: `0x${string}`;
  amountBaseUnits?: string;
}): PreparedMoneyAction & { metadata: SavingsMoneyActionMetadata } {
  const deposit = operation === "deposit";
  const previewSharesBaseUnits = (BigInt(amountBaseUnits) * BigInt(10) ** BigInt(12)).toString();
  const ownerAddress = sessionBody.smartAccount.address as `0x${string}`;
  const amount = BigInt(amountBaseUnits);
  const floorMinimumShares = BigInt(previewSharesBaseUnits) * BigInt(9990) / BigInt(10000);
  const maxSharePriceE27 = amount * BigInt(10) ** BigInt(27) / floorMinimumShares;
  const minimumShares = (amount * BigInt(10) ** BigInt(27) + maxSharePriceE27 - BigInt(1)) / maxSharePriceE27;
  const bundleItem = (data: `0x${string}`) => ({ to: adapter, data, value: BigInt(0), skipRevert: false, callbackHash: `0x${"00".repeat(32)}` as `0x${string}` });
  const vaultCall = deposit
    ? encodeFunctionData({ abi: bundlerAbi, functionName: "multicall", args: [[
      bundleItem(encodeFunctionData({ abi: adapterAbi, functionName: "erc20TransferFrom", args: [PORTFOLIO_USDC_ADDRESS, adapter, amount] })),
      bundleItem(encodeFunctionData({ abi: adapterAbi, functionName: "erc4626Deposit", args: [vaultAddress, amount, maxSharePriceE27, ownerAddress] })),
    ]] })
    : encodeFunctionData({ abi: parseAbi(["function withdraw(uint256 assets, address receiver, address owner)"]), functionName: "withdraw", args: [amount, ownerAddress, ownerAddress] });
  const vault = portfolioVaults.find((candidate) => candidate.address.toLowerCase() === vaultAddress.toLowerCase()) ?? portfolioVaults[0];
  const metadata = {
    product: "savings",
    operation,
    vaultAddress,
    vaultName: vault.name,
    network: { name: "Base", chainId: 8453 },
    feeWad: "100000000000000000",
    limitBaseUnits: "50000000",
    previewSharesBaseUnits,
    shareDecimals: 18,
    ...(deposit ? { minimumSharesBaseUnits: minimumShares.toString() } : {}),
    exchangeConstraint: deposit ? "deposit-minimum-shares-or-revert" : "withdraw-exact-assets-or-revert",
    discoveryRate: { status: "stale", netApy: "0.035", fetchedAt: fixtureCreatedAt, stateAsOf: fixtureCreatedAt },
    source: { blockNumber: "51026404", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: fixtureBlockTimestamp },
  } satisfies SavingsMoneyActionMetadata;
  return {
    id: savingsFixtureActionIds[operation],
    owner: { subject: sessionBody.user.subject, address: ownerAddress, chainId: 8453, accountProvider: "cdp-embedded" },
    kind: deposit ? "savings-deposit" : "savings-withdraw",
    title: deposit ? "Deposit USDC into Morpho" : "Withdraw USDC from Morpho",
    networkFee: { payment: "usdc", token: PORTFOLIO_USDC_ADDRESS, paymaster: BASE_USDC_PAYMASTER_ADDRESS, maxFeeBaseUnits: "20000", decimals: 6 },
    calls: [
      { to: PORTFOLIO_USDC_ADDRESS, data: `0x095ea7b3${BASE_USDC_PAYMASTER_ADDRESS.slice(2).toLowerCase().padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}`, value: "0", approval: { assetId: "usdc", spender: BASE_USDC_PAYMASTER_ADDRESS } },
      ...(deposit ? [{ to: PORTFOLIO_USDC_ADDRESS, data: `0x095ea7b3${adapter.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` as `0x${string}`, value: "0", approval: { assetId: `eip155:8453/erc20:${PORTFOLIO_USDC_ADDRESS.toLowerCase()}`, spender: adapter } }] : []),
      { to: deposit ? bundler : vaultAddress, data: vaultCall, value: "0" },
    ],
    amounts: [
      { assetId: `eip155:8453/erc20:${PORTFOLIO_USDC_ADDRESS.toLowerCase()}`, symbol: "USDC", decimals: 6, amountBaseUnits, direction: deposit ? "spend" : "receive" },
      { assetId: `eip155:8453/erc20:${vaultAddress.toLowerCase()}`, symbol: "vault shares", decimals: 18, amountBaseUnits: previewSharesBaseUnits, direction: deposit ? "receive" : "spend", estimated: true },
    ],
    warnings: [],
    metadata,
    createdAt: fixtureCreatedAt,
    expiresAt: fixtureExpiresAt,
  };
}
