import "server-only";

import { encodeFunctionData, erc20Abi } from "viem";
import { baseRpcBatch, parseRpcDataWord } from "@/server/chain/rpc";
import { readDatabaseUrl } from "@/server/config/env";
import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { emitServerEvent } from "@/server/observability/log";
import { OperatorSettingsStore } from "@/server/operator-settings/store";
import { OPERATOR_SETTINGS_PAGE_READ_TIMEOUT_MS } from "@/server/operator-settings/regions";
import { MONEY_MOVEMENTS_PAGE_SIZE, type AdminMoneyPageData, type OperatorAccountBalance } from "@/shared/admin-money/contract";
import { parseAddress, type Address } from "@/shared/chain/hex";
import { parseOperatorFeeSettings } from "@/shared/fees/contract";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { parseGrowthSettings } from "@/shared/operator-settings/growth";
import { listMoneyMovements } from "./movements";

type BalanceRead = (addresses: readonly Address[]) => Promise<Array<bigint | null>>;

const ROUTE = "/admin/money";

const readUsdcBalances: BalanceRead = async (addresses) => {
  if (!addresses.length) return [];
  const results = await baseRpcBatch(addresses.map((address) => ({
    method: "eth_call",
    params: [{ to: BASE_USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [address] }) }, "latest"],
  })), { allowPartial: true });
  return results.map((value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? parseRpcDataWord(value, "USDC balance") : null);
};

async function configuredAccounts(sql: SqlExecutor): Promise<[Address | null | undefined, Address | null | undefined]> {
  const store = new OperatorSettingsStore(sql);
  const options = { timeoutMs: OPERATOR_SETTINGS_PAGE_READ_TIMEOUT_MS };
  const [fees, growth] = await Promise.allSettled([store.read("fees", options), store.read("growth", options)]);
  const destination = fees.status === "fulfilled" ? parseOperatorFeeSettings(fees.value.settings.value)?.trade.recipient : undefined;
  const payout = growth.status === "fulfilled" ? parseGrowthSettings(growth.value.settings.value)?.payoutAccount : undefined;
  return [
    destination === undefined ? undefined : destination && parseAddress(destination),
    payout === undefined ? undefined : payout,
  ];
}

export async function readAdminMoneyPageData(readBalances: BalanceRead = readUsdcBalances): Promise<AdminMoneyPageData | null> {
  if (!readDatabaseUrl()) return null;
  const sql = getSqlExecutor();
  const unavailable = (code: string) => () => {
    emitServerEvent("operator-registry", { route: ROUTE, code, outcome: "failed" });
    return null;
  };
  const [accounts, rows] = await Promise.all([
    configuredAccounts(sql),
    listMoneyMovements(sql, { range: { from: null, to: null }, limit: MONEY_MOVEMENTS_PAGE_SIZE + 1 }, { timeoutMs: OPERATOR_SETTINGS_PAGE_READ_TIMEOUT_MS })
      .catch(unavailable("MONEY_MOVEMENTS_UNAVAILABLE")),
  ]);
  const unique = [...new Set(accounts.filter((account): account is Address => typeof account === "string"))];
  const balances = await readBalances(unique).catch(unavailable("MONEY_BALANCES_UNAVAILABLE"));
  const account = (address: Address | null | undefined): OperatorAccountBalance => {
    if (address === undefined) return { kind: "unavailable" };
    if (address === null) return { kind: "unset" };
    const balance = balances?.[unique.indexOf(address)] ?? null;
    return { kind: "configured", address, usdcBaseUnits: balance === null ? null : balance.toString() };
  };
  return {
    revenueDestination: account(accounts[0]),
    payoutAccount: account(accounts[1]),
    movements: rows ? { rows: rows.slice(0, MONEY_MOVEMENTS_PAGE_SIZE), truncated: rows.length > MONEY_MOVEMENTS_PAGE_SIZE } : null,
  };
}
