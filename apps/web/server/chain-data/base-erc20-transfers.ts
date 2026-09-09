import { ChainDataError } from "./errors";
import {
  BASE_MAINNET_CHAIN_ID,
  type BaseErc20Asset,
  type BaseErc20Transfer,
  type BaseErc20TransferPage,
  type CdpSqlMetadata,
  type CdpSqlResponse,
  type CdpSqlTransport,
  type HexAddress,
  type ListBaseErc20TransfersInput,
  type TransactionHash,
  type TransferHistoryCursor,
} from "./types";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_ASSETS_PER_QUERY = 20;
const MAX_TIME_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_CACHE_AGE_MS = 15 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 60 * 1000;
const TRANSFER_SIGNATURE = "Transfer(address,address,uint256)";
const MAX_LOG_ID_LENGTH = 256;
// Includes UTF-8, JSON escaping, and base64 expansion of bounded log IDs.
const MAX_ENCODED_CURSOR_LENGTH = 4096;

export type BaseErc20TransferHistoryOptions = {
  assets: readonly BaseErc20Asset[];
  transport: CdpSqlTransport;
  now?: () => Date;
};

type ValidatedRequest = {
  walletAddress: HexAddress;
  assets: BaseErc20Asset[];
  from: string;
  to: string;
  limit: number;
  cursor: TransferHistoryCursor | null;
  cacheMaxAgeMs: number | null;
  staleAfterMs: number;
};

type TransferRow = {
  log_id: string;
  block_number: string;
  block_hash: string;
  source_timestamp: string;
  transaction_hash: string;
  log_index: string;
  token_address: string;
  from_address: string;
  to_address: string;
  amount_base_units: string;
};

export function normalizeBaseAddress(value: string): HexAddress {
  const normalized = value.trim().toLowerCase();
  if (!ADDRESS_PATTERN.test(normalized)) {
    throw new ChainDataError("invalid-input", "Expected a 20-byte EVM address.");
  }
  return normalized as HexAddress;
}

export function buildBaseErc20TransferQuery(
  input: ListBaseErc20TransfersInput,
  assets: readonly BaseErc20Asset[],
  now = new Date(),
): { sql: string; request: ValidatedRequest } {
  const request = validateRequest(input, assets, now);
  const wallet = sqlString(request.walletAddress);
  const assetAddresses = request.assets
    .map((asset) => sqlString(asset.address))
    .join(", ");
  const cursorClause = request.cursor
    ? `\n  AND ${buildCursorPredicate(request.cursor)}`
    : "";

  // Re-org safety is intentional: action is aggregated for every stable log_id,
  // and only net-active logs are paginated. Filtering action = 'added' would
  // leave removed logs in history.
  //
  // CoinbaSeQL's published selectStatement is GROUP BY then optional ORDER BY /
  // LIMIT — no HAVING. #46 nested ORDER BY … LIMIT after HAVING; #73 removed
  // that inner limit but left HAVING, and prod /api/activity stayed 502
  // ACTIVITY_UNAVAILABLE for healthy empty sessions (#70). Filter net action
  // in the outer WHERE (the documented subquery pattern) and page with the
  // outer LIMIT only.
  const sql = `SELECT
  log_id,
  toString(block_number_numeric) AS block_number,
  block_hash,
  formatDateTime(event_timestamp, '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS source_timestamp,
  transaction_hash,
  toString(log_index_numeric) AS log_index,
  lower(token_address) AS token_address,
  lower(from_address) AS from_address,
  lower(to_address) AS to_address,
  amount_base_units
FROM (
  SELECT
    log_id,
    any(block_number) AS block_number_numeric,
    any(block_hash) AS block_hash,
    any(block_timestamp) AS event_timestamp,
    any(transaction_hash) AS transaction_hash,
    any(log_index) AS log_index_numeric,
    any(toString(address)) AS token_address,
    any(toString(parameters['from'])) AS from_address,
    any(toString(parameters['to'])) AS to_address,
    any(toString(parameters['value'])) AS amount_base_units,
    sum(toInt8(action)) AS net_action
  FROM base.events
  WHERE event_signature = '${TRANSFER_SIGNATURE}'
    AND address IN (${assetAddresses})
    AND block_timestamp >= parseDateTime64BestEffort(${sqlString(request.from)})
    AND block_timestamp < parseDateTime64BestEffort(${sqlString(request.to)})
    AND (
      lower(toString(parameters['from'])) = ${wallet}
      OR lower(toString(parameters['to'])) = ${wallet}
    )
  GROUP BY log_id
)
WHERE net_action > 0${cursorClause}
ORDER BY block_number_numeric DESC, transaction_hash DESC, log_index_numeric DESC, log_id DESC
LIMIT ${request.limit + 1}`;

  return { sql, request };
}

export function createBaseErc20TransferHistory({
  assets,
  transport,
  now = () => new Date(),
}: BaseErc20TransferHistoryOptions) {
  const allowlist = validateAllowlist(assets);

  return {
    async listTransfers(
      input: ListBaseErc20TransfersInput,
    ): Promise<BaseErc20TransferPage> {
      const fetchedAt = now();
      const { sql, request } = buildBaseErc20TransferQuery(
        input,
        allowlist,
        fetchedAt,
      );
      const response = await transport.run({
        sql,
        cache:
          request.cacheMaxAgeMs === null
            ? undefined
            : { maxAgeMs: request.cacheMaxAgeMs },
        signal: input.signal,
      });
      const metadata = parseMetadata(response);
      const parsedRows = response.result.map((row) => parseTransferRow(row));
      const pageRows = parsedRows.slice(0, request.limit);
      const addressToAsset = new Map(
        request.assets.map((asset) => [asset.address, asset]),
      );
      const transfers = pageRows.map((row) =>
        normalizeTransfer(row, request.walletAddress, addressToAsset),
      );
      const nextCursor =
        parsedRows.length > request.limit && transfers.length > 0
          ? encodeTransferCursor({
              blockNumber: transfers.at(-1)!.blockNumber,
              transactionHash: transfers.at(-1)!.transactionHash,
              logIndex: transfers.at(-1)!.logIndex,
              logId: transfers.at(-1)!.id,
            })
          : null;
      const executionTimestamp = normalizeTimestamp(
        metadata.executionTimestamp,
        "metadata.executionTimestamp",
      );

      return {
        transfers,
        nextCursor,
        source: {
          provider: "cdp-sql",
          cached: metadata.cached,
          stale:
            fetchedAt.getTime() - new Date(executionTimestamp).getTime() >
            request.staleAfterMs,
          executionTimestamp,
          executionTimeMs: metadata.executionTimeMs,
          fetchedAt: fetchedAt.toISOString(),
        },
      };
    },
  };
}

export function encodeTransferCursor(cursor: TransferHistoryCursor): string {
  validateCursor(cursor);
  const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  if (encoded.length > MAX_ENCODED_CURSOR_LENGTH) {
    throw new ChainDataError("invalid-input", "Invalid transfer cursor.");
  }
  return encoded;
}

export function decodeTransferCursor(value: string): TransferHistoryCursor {
  if (value.length === 0 || value.length > MAX_ENCODED_CURSOR_LENGTH) {
    throw new ChainDataError("invalid-input", "Invalid transfer cursor.");
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!isRecord(parsed)) {
      throw new Error("cursor is not an object");
    }
    const cursor = {
      blockNumber: parsed.blockNumber,
      transactionHash: parsed.transactionHash,
      logIndex: parsed.logIndex,
      logId: parsed.logId,
    };
    validateCursor(cursor);
    return cursor;
  } catch (error) {
    if (error instanceof ChainDataError) throw error;
    throw new ChainDataError("invalid-input", "Invalid transfer cursor.", {
      cause: error,
    });
  }
}

function validateRequest(
  input: ListBaseErc20TransfersInput,
  assets: readonly BaseErc20Asset[],
  now: Date,
): ValidatedRequest {
  const allowlist = validateAllowlist(assets);
  const walletAddress = normalizeBaseAddress(input.verifiedWalletAddress);
  const assetIds = [...new Set(input.assetIds)];
  if (assetIds.length === 0 || assetIds.length > MAX_ASSETS_PER_QUERY) {
    throw new ChainDataError(
      "invalid-input",
      `Choose between 1 and ${MAX_ASSETS_PER_QUERY} allowlisted assets.`,
    );
  }
  const byId = new Map(allowlist.map((asset) => [asset.id, asset]));
  const selectedAssets = assetIds.map((assetId) => {
    const asset = byId.get(assetId);
    if (!asset) {
      throw new ChainDataError("invalid-input", "Requested asset is not allowlisted.");
    }
    return asset;
  });
  const fromDate = parseInputTimestamp(input.from, "from");
  const toDate = parseInputTimestamp(input.to, "to");
  if (fromDate >= toDate) {
    throw new ChainDataError("invalid-input", "The history start must be before its end.");
  }
  if (toDate.getTime() - fromDate.getTime() > MAX_TIME_RANGE_MS) {
    throw new ChainDataError("invalid-input", "History windows cannot exceed 31 days.");
  }
  if (toDate.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new ChainDataError("invalid-input", "History end cannot be in the future.");
  }
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ChainDataError(
      "invalid-input",
      `History page size must be between 1 and ${MAX_PAGE_SIZE}.`,
    );
  }
  const cacheMaxAgeMs = input.cacheMaxAgeMs ?? null;
  if (
    cacheMaxAgeMs !== null &&
    (!Number.isSafeInteger(cacheMaxAgeMs) ||
      cacheMaxAgeMs < 500 ||
      cacheMaxAgeMs > MAX_CACHE_AGE_MS)
  ) {
    throw new ChainDataError(
      "invalid-input",
      "CDP SQL cache age must be between 500 and 900000 milliseconds.",
    );
  }
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) {
    throw new ChainDataError("invalid-input", "Stale threshold must be a non-negative integer.");
  }

  return {
    walletAddress,
    assets: selectedAssets,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    limit,
    cursor: input.cursor ? decodeTransferCursor(input.cursor) : null,
    cacheMaxAgeMs,
    staleAfterMs,
  };
}

function validateAllowlist(
  assets: readonly BaseErc20Asset[],
): BaseErc20Asset[] {
  const ids = new Set<string>();
  const addresses = new Set<string>();
  return assets.map((asset) => {
    if (!asset.id || asset.id.length > 128 || ids.has(asset.id)) {
      throw new ChainDataError("invalid-input", "Asset IDs must be unique and non-empty.");
    }
    if (asset.chainId !== BASE_MAINNET_CHAIN_ID) {
      throw new ChainDataError("invalid-input", "Only Base mainnet assets are supported.");
    }
    const address = normalizeBaseAddress(asset.address);
    if (addresses.has(address)) {
      throw new ChainDataError("invalid-input", "Asset addresses must be unique.");
    }
    ids.add(asset.id);
    addresses.add(address);
    return { ...asset, address };
  });
}

function parseTransferRow(value: unknown): TransferRow {
  if (!isRecord(value)) {
    throw invalidResponse("CDP SQL returned a non-object transfer row.");
  }
  const row = {
    log_id: requiredString(value, "log_id"),
    block_number: requiredString(value, "block_number"),
    block_hash: requiredString(value, "block_hash"),
    source_timestamp: requiredString(value, "source_timestamp"),
    transaction_hash: requiredString(value, "transaction_hash"),
    log_index: requiredString(value, "log_index"),
    token_address: requiredString(value, "token_address"),
    from_address: requiredString(value, "from_address"),
    to_address: requiredString(value, "to_address"),
    amount_base_units: requiredString(value, "amount_base_units"),
  };
  if (row.log_id.length === 0 || row.log_id.length > MAX_LOG_ID_LENGTH) {
    throw invalidResponse("CDP SQL returned an invalid log ID.");
  }
  for (const [name, decimal] of [
    ["block_number", row.block_number],
    ["log_index", row.log_index],
    ["amount_base_units", row.amount_base_units],
  ] as const) {
    if (!DECIMAL_INTEGER_PATTERN.test(decimal)) {
      throw invalidResponse(`CDP SQL returned a non-decimal ${name}.`);
    }
  }
  normalizeHash(row.block_hash, "block_hash");
  normalizeHash(row.transaction_hash, "transaction_hash");
  normalizeTimestamp(row.source_timestamp, "source_timestamp");
  normalizeBaseAddressResponse(row.token_address);
  normalizeBaseAddressResponse(row.from_address);
  normalizeBaseAddressResponse(row.to_address);
  return row;
}

function normalizeTransfer(
  row: TransferRow,
  walletAddress: HexAddress,
  addressToAsset: ReadonlyMap<HexAddress, BaseErc20Asset>,
): BaseErc20Transfer {
  const tokenAddress = normalizeBaseAddressResponse(row.token_address);
  const asset = addressToAsset.get(tokenAddress);
  if (!asset) {
    throw invalidResponse("CDP SQL returned a token outside the request allowlist.");
  }
  const fromAddress = normalizeBaseAddressResponse(row.from_address);
  const toAddress = normalizeBaseAddressResponse(row.to_address);
  if (fromAddress !== walletAddress && toAddress !== walletAddress) {
    throw invalidResponse("CDP SQL returned a transfer outside the verified wallet scope.");
  }
  const direction =
    fromAddress === walletAddress && toAddress === walletAddress
      ? "self"
      : toAddress === walletAddress
        ? "incoming"
        : "outgoing";

  return {
    id: row.log_id,
    chainId: BASE_MAINNET_CHAIN_ID,
    assetId: asset.id,
    tokenAddress,
    walletAddress,
    fromAddress,
    toAddress,
    direction,
    amountBaseUnits: row.amount_base_units,
    blockNumber: row.block_number,
    blockHash: normalizeHash(row.block_hash, "block_hash"),
    transactionHash: normalizeHash(row.transaction_hash, "transaction_hash"),
    logIndex: row.log_index,
    blockTimestamp: normalizeTimestamp(row.source_timestamp, "source_timestamp"),
  };
}

function parseMetadata(response: CdpSqlResponse): CdpSqlMetadata {
  if (!Array.isArray(response.result) || !isRecord(response.metadata)) {
    throw invalidResponse("CDP SQL returned an invalid result envelope.");
  }
  const { metadata } = response;
  if (
    typeof metadata.cached !== "boolean" ||
    typeof metadata.executionTimestamp !== "string" ||
    !Number.isSafeInteger(metadata.executionTimeMs) ||
    metadata.executionTimeMs < 0 ||
    !Number.isSafeInteger(metadata.rowCount) ||
    metadata.rowCount < 0
  ) {
    throw invalidResponse("CDP SQL returned invalid execution metadata.");
  }
  if (metadata.rowCount !== response.result.length) {
    throw invalidResponse("CDP SQL row count did not match the result.");
  }
  return metadata as CdpSqlMetadata;
}

function buildCursorPredicate(cursor: TransferHistoryCursor): string {
  const block = `toUInt64(${sqlString(cursor.blockNumber)})`;
  const transactionHash = sqlString(cursor.transactionHash);
  const logIndex = `toUInt32(${sqlString(cursor.logIndex)})`;
  const logId = sqlString(cursor.logId);
  return `(block_number_numeric < ${block}
    OR (block_number_numeric = ${block} AND transaction_hash < ${transactionHash})
    OR (block_number_numeric = ${block} AND transaction_hash = ${transactionHash} AND log_index_numeric < ${logIndex})
    OR (block_number_numeric = ${block} AND transaction_hash = ${transactionHash} AND log_index_numeric = ${logIndex} AND log_id < ${logId}))`;
}

function validateCursor(value: unknown): asserts value is TransferHistoryCursor {
  if (!isRecord(value)) {
    throw new ChainDataError("invalid-input", "Invalid transfer cursor.");
  }
  if (
    typeof value.blockNumber !== "string" ||
    !DECIMAL_INTEGER_PATTERN.test(value.blockNumber) ||
    typeof value.logIndex !== "string" ||
    !DECIMAL_INTEGER_PATTERN.test(value.logIndex) ||
    typeof value.transactionHash !== "string" ||
    !HASH_PATTERN.test(value.transactionHash) ||
    typeof value.logId !== "string" ||
    value.logId.length === 0 ||
    value.logId.length > MAX_LOG_ID_LENGTH
  ) {
    throw new ChainDataError("invalid-input", "Invalid transfer cursor.");
  }
}

function parseInputTimestamp(value: string, field: string): Date {
  if (typeof value !== "string" || value.length > 64) {
    throw new ChainDataError("invalid-input", `Invalid ${field} timestamp.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ChainDataError("invalid-input", `Invalid ${field} timestamp.`);
  }
  return parsed;
}

function normalizeTimestamp(value: string, field: string): string {
  const withZone = /(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(withZone);
  if (!Number.isFinite(parsed.getTime())) {
    throw invalidResponse(`CDP SQL returned an invalid ${field}.`);
  }
  return parsed.toISOString();
}

function normalizeBaseAddressResponse(value: string): HexAddress {
  try {
    return normalizeBaseAddress(value);
  } catch (error) {
    throw invalidResponse("CDP SQL returned an invalid EVM address.", error);
  }
}

function normalizeHash(value: string, field: string): TransactionHash {
  const normalized = value.toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw invalidResponse(`CDP SQL returned an invalid ${field}.`);
  }
  return normalized as TransactionHash;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw invalidResponse(`CDP SQL field ${key} must be a string.`);
  }
  return value;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function invalidResponse(message: string, cause?: unknown): ChainDataError {
  return new ChainDataError("invalid-response", message, { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
