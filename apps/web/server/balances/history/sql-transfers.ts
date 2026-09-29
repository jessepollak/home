import "server-only";

import type { CdpSqlTransport } from "@/server/chain-data/types";
import { ChainDataError } from "@/server/chain-data/errors";
import { contractHistoryAsset } from "./assets";
import type { BalanceChange, HexAddress, HistoryTransferSource, TransferSourceResult } from "./types";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const THIRTY_ONE_DAYS_MS = 31 * 86_400_000;
const HOUR_MS = 3_600_000;

type Window = { fromBlock: bigint; toBlock: bigint; fromMs: number; toMs: number };
type ParsedTransfer = { change: BalanceChange; content: string };

function invalidResponse(): ChainDataError {
  return new ChainDataError("invalid-response", "CDP SQL returned an invalid history transfer row.");
}

function address(value: unknown, code: "invalid-input" | "invalid-response"): HexAddress {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw code === "invalid-input"
      ? new ChainDataError(code, "Expected a 20-byte EVM address.")
      : invalidResponse();
  }
  return value.toLowerCase() as HexAddress;
}

function decimal(value: unknown): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value) || value.length > 78) throw invalidResponse();
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) throw invalidResponse();
  return parsed;
}

function rowToChange(value: unknown, wallet: HexAddress, window: Window): ParsedTransfer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidResponse();
  const row = value as Record<string, unknown>;
  const token = address(row.token_address, "invalid-response");
  const from = address(row.from_address, "invalid-response");
  const to = address(row.to_address, "invalid-response");
  if (from !== wallet && to !== wallet) throw invalidResponse();
  const blockNumber = decimal(row.block_number);
  if (blockNumber <= window.fromBlock || blockNumber > window.toBlock) return null;
  const logIndexBigint = decimal(row.log_index);
  if (logIndexBigint > BigInt(2_147_483_647)) throw invalidResponse();
  const amount = decimal(row.amount_base_units);
  if (typeof row.source_timestamp !== "string" || !ISO_TIME.test(row.source_timestamp)) throw invalidResponse();
  const blockTime = new Date(row.source_timestamp);
  if (!Number.isFinite(blockTime.getTime())) throw invalidResponse();
  return {
    change: {
      asset: contractHistoryAsset(token),
      blockNumber,
      logIndex: Number(logIndexBigint),
      blockTime,
      txHash: null,
      delta: (to === wallet ? amount : BigInt(0)) - (from === wallet ? amount : BigInt(0)),
    },
    content: `${from}:${to}:${amount}:${blockTime.getTime()}`,
  };
}

function query(window: Window, wallet: HexAddress, maxRows: number): string {
  const earliest = new Date(window.fromMs - HOUR_MS).toISOString();
  const latest = new Date(window.toMs + HOUR_MS).toISOString();
  return `SELECT
  toString(block_number_numeric) AS block_number,
  formatDateTime(event_timestamp, '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS source_timestamp,
  toString(log_index_numeric) AS log_index,
  token_key AS token_address,
  sender_key AS from_address,
  recipient_key AS to_address,
  amount_key AS amount_base_units
FROM (
  SELECT
    block_number AS block_number_numeric,
    log_index AS log_index_numeric,
    lower(token_address) AS token_key,
    any(block_timestamp) AS event_timestamp,
    lower(from_address) AS sender_key,
    lower(to_address) AS recipient_key,
    toString(value) AS amount_key,
    sum(if(action = 'added', 1, -1)) AS net_action
  FROM base.transfers AS transfer_rows
  WHERE block_timestamp >= parseDateTime64BestEffort('${earliest}')
    AND block_timestamp <= parseDateTime64BestEffort('${latest}')
    AND (transfer_rows.from_address = '${wallet}' OR transfer_rows.to_address = '${wallet}')
  GROUP BY block_number, log_index, lower(token_address), lower(from_address), lower(to_address), toString(value)
)
WHERE net_action > 0
ORDER BY block_number_numeric, log_index_numeric
LIMIT ${maxRows + 1}`;
}

function split(window: Window, atMs: number): [Window, Window] {
  const middleBlock = window.fromBlock +
    ((window.toBlock - window.fromBlock) * BigInt(atMs - window.fromMs)) /
      BigInt(window.toMs - window.fromMs);
  return [
    { ...window, toBlock: middleBlock, toMs: atMs },
    { ...window, fromBlock: middleBlock, fromMs: atMs },
  ];
}

function canSplit(window: Window, atMs: number): boolean {
  if (atMs <= window.fromMs || atMs >= window.toMs) return false;
  const [left, right] = split(window, atMs);
  return left.toBlock > left.fromBlock && right.toBlock > right.fromBlock;
}

function recoverable(error: unknown): boolean {
  return error instanceof ChainDataError &&
    (error.code === "timed-out" || (error.code === "upstream-error" && (error.status === 400 || error.status === 413)));
}

export function createHistoryTransferSource(options: {
  transport: CdpSqlTransport;
  maxRows?: number;
  minWindowSeconds?: number;
}): HistoryTransferSource {
  const { transport, maxRows = 49_999, minWindowSeconds = 86_400 } = options;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(minWindowSeconds) || minWindowSeconds < 1) {
    throw new ChainDataError("invalid-input", "Invalid history transfer source limits.");
  }
  return {
    async listChanges(input): Promise<TransferSourceResult> {
      const wallet = address(input.address, "invalid-input");
      const fromMs = input.fromTime.getTime();
      const toMs = input.toTime.getTime();
      if (input.fromBlockExclusive < BigInt(0) || input.toBlockInclusive < input.fromBlockExclusive ||
          input.toBlockInclusive > BigInt("9223372036854775807") ||
          !Number.isFinite(fromMs) || !Number.isFinite(toMs) ||
          !Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) ||
          fromMs >= toMs || fromMs < HOUR_MS || toMs > 8_640_000_000_000_000 - HOUR_MS) {
        throw new ChainDataError("invalid-input", "Invalid history transfer block or time range.");
      }
      if (input.fromBlockExclusive === input.toBlockInclusive) return { changes: [], queries: 0, windows: 0 };
      const root: Window = {
        fromBlock: input.fromBlockExclusive,
        toBlock: input.toBlockInclusive,
        fromMs,
        toMs,
      };
      let queries = 0;
      let windows = 0;
      const changes: ParsedTransfer[] = [];
      const fetchWindow = async (window: Window): Promise<void> => {
        if (window.fromBlock === window.toBlock) return;
        let overflow = false;
        try {
          queries += 1;
          const response = await transport.run({ sql: query(window, wallet, maxRows), signal: input.signal });
          if (!Array.isArray(response.result)) throw invalidResponse();
          if (response.result.length !== response.metadata.rowCount || response.result.length > maxRows ||
              response.result.length >= 50_000 || response.metadata.rowCount >= 50_000) {
            overflow = true;
          } else {
            const parsed = response.result.flatMap((row) => rowToChange(row, wallet, window) ?? []);
            changes.push(...parsed);
            windows += 1;
            return;
          }
        } catch (error) {
          if (!recoverable(error) || input.signal?.aborted) throw error;
          if (window.toMs - window.fromMs <= minWindowSeconds * 1000) throw error;
        }
        if (window.toMs - window.fromMs <= minWindowSeconds * 1000) {
          throw new ChainDataError("upstream-error", "CDP SQL history window exceeded the row limit.");
        }
        const middle = window.fromMs + Math.floor((window.toMs - window.fromMs) / 2);
        if (!canSplit(window, middle)) {
          throw new ChainDataError("upstream-error", overflow
            ? "CDP SQL history window exceeded the row limit."
            : "CDP SQL history window cannot be split further.");
        }
        const [left, right] = split(window, middle);
        await fetchWindow(left);
        await fetchWindow(right);
      };
      const tryWhole = async (): Promise<void> => {
        let current = root;
        while (current.toMs - current.fromMs > THIRTY_ONE_DAYS_MS) {
          const [first, remainder] = split(current, current.fromMs + THIRTY_ONE_DAYS_MS);
          await fetchWindow(first);
          current = remainder;
        }
        await fetchWindow(current);
      };
      await tryWhole();
      const seen = new Map<string, string>();
      const unique: BalanceChange[] = [];
      for (const { change, content } of changes) {
        const key = `${change.asset.key}:${change.blockNumber}:${change.logIndex}`;
        const previous = seen.get(key);
        if (previous !== undefined) {
          if (previous !== content) throw invalidResponse();
          continue;
        }
        seen.set(key, content);
        unique.push(change);
      }
      unique.sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex);
      return { changes: unique, queries, windows };
    },
  };
}
