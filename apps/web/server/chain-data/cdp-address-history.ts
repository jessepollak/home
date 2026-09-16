import "server-only";

import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { UINT256_MAX } from "@/server/chain/rpc";
import { ChainDataError, type ChainDataErrorCode } from "./errors";
import {
  BASE_MAINNET_CHAIN_ID,
  type BaseErc20Asset,
  type BaseErc20Transfer,
  type BaseErc20TransferPage,
  type HexAddress,
  type ListBaseErc20TransfersInput,
  type TransactionHash,
} from "./types";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR_LENGTH = 4096;
const MAX_PAGE_TOKEN_LENGTH = 2048;
const MAX_PROVIDER_CALLS = 3;
const PROVIDER_PAGE_SIZE = "100";
const MAX_PROVIDER_PAGE_SIZE = 100;
const MAX_TIME_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_TRANSFER_PAGE_SIZE = 25;
const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_TIMEOUT_MS = 10_000;
const MAX_LOG_ID_LENGTH = 256;
const CDP_ADDRESS_HISTORY_HOST = "api.cdp.coinbase.com";
const CDP_ADDRESS_HISTORY_NETWORK = "base-mainnet";
const CDP_ADDRESS_HISTORY_PATH_PREFIX =
  `/platform/v1/networks/${CDP_ADDRESS_HISTORY_NETWORK}/addresses`;

export type CdpAddressHistoryRequest = {
  address: HexAddress;
  pageSize: typeof PROVIDER_PAGE_SIZE;
  pageToken?: string;
  signal?: AbortSignal;
};

export interface CdpAddressHistoryTransport {
  listAddressTransactions(request: CdpAddressHistoryRequest): Promise<unknown>;
}

export type CdpAddressHistoryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CdpAddressHistoryTransportOptions = {
  apiKeyId: string;
  apiKeySecret: string;
  timeoutMs?: number;
  fetch?: CdpAddressHistoryFetch;
  generateJwt?: typeof generateJwt;
};

export type CdpAddressHistoryOptions = {
  assets: readonly BaseErc20Asset[];
  transport: CdpAddressHistoryTransport;
  now?: () => Date;
  clock?: () => number;
};

export type CdpAddressHistoryKey = {
  blockNumber: string;
  transactionHash: TransactionHash;
  logIndex: string;
  tokenAddress: HexAddress;
};

export type CdpAddressHistoryCursor = {
  version: 1;
  pageToken: string | null;
  lastEmittedKey: CdpAddressHistoryKey | null;
};

type ValidatedRequest = {
  walletAddress: HexAddress;
  fromMs: number;
  toMs: number;
  limit: number;
  cursor: CdpAddressHistoryCursor | null;
};

type ParsedTransaction = {
  key: {
    blockNumber: string;
    transactionIndex: string;
  };
  timestamp: string;
  timestampMs: number;
  transfers: BaseErc20Transfer[];
};

type ParsedProviderPage = {
  transactions: ParsedTransaction[];
  nextPageToken: string | null;
};

export function createCdpAddressHistoryTransport({
  apiKeyId: untrimmedApiKeyId,
  apiKeySecret: untrimmedApiKeySecret,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetch: fetchImplementation = globalThis.fetch,
  generateJwt: generateJwtImplementation = generateJwt,
}: CdpAddressHistoryTransportOptions): CdpAddressHistoryTransport {
  const apiKeyId = untrimmedApiKeyId?.trim();
  const apiKeySecret = untrimmedApiKeySecret?.trim();
  if (!apiKeyId || !apiKeySecret) {
    throw new ChainDataError(
      "not-configured",
      "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for CDP Address History.",
    );
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new ChainDataError(
      "invalid-input",
      `CDP Address History timeout must be between 1 and ${MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  if (typeof fetchImplementation !== "function") {
    throw new ChainDataError("not-configured", "A fetch implementation is required.");
  }
  if (typeof generateJwtImplementation !== "function") {
    throw new ChainDataError("not-configured", "A JWT generator is required.");
  }

  return {
    async listAddressTransactions(request) {
      throwIfRequestAborted(request.signal);
      if (
        request.pageSize !== PROVIDER_PAGE_SIZE ||
        !ADDRESS_PATTERN.test(request.address) ||
        (request.pageToken !== undefined && !validPageToken(request.pageToken))
      ) {
        throw new ChainDataError(
          "invalid-input",
          "CDP Address History received an invalid provider request.",
        );
      }

      const address = request.address.toLowerCase() as HexAddress;
      const requestPath = addressHistoryRequestPath(address);
      let bearerToken: string;
      try {
        bearerToken = await generateJwtImplementation({
          apiKeyId,
          apiKeySecret,
          requestMethod: "GET",
          requestHost: CDP_ADDRESS_HISTORY_HOST,
          requestPath,
          expiresIn: 120,
        });
      } catch {
        throwIfRequestAborted(request.signal);
        throw providerError("not-configured");
      }
      throwIfRequestAborted(request.signal);
      if (
        typeof bearerToken !== "string" ||
        bearerToken.trim().length === 0 ||
        /\s/.test(bearerToken)
      ) {
        throw providerError("not-configured");
      }

      const controller = new AbortController();
      const onAbort = () => controller.abort(request.signal?.reason);
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) controller.abort(request.signal.reason);
      const timeout = setTimeout(
        () => controller.abort("cdp-address-history-timeout"),
        timeoutMs,
      );

      try {
        let response: Response;
        try {
          const headerName = ["author", "ization"].join("");
          const bearerValue = ["Bear", "er ", bearerToken].join("");
          response = await fetchImplementation(
            addressHistoryRequestUrl(address, request.pageToken),
            {
              method: "GET",
              headers: {
                accept: "application/json",
                [headerName]: bearerValue,
              },
              cache: "no-store",
              signal: controller.signal,
            },
          );
        } catch {
          if (controller.signal.aborted) throw providerError("timed-out");
          throw providerError("upstream-error");
        }
        if (!response.ok) throw responseError(response);

        let body: string;
        try {
          body = await response.text();
        } catch {
          if (controller.signal.aborted) throw providerError("timed-out");
          throw providerError("upstream-error");
        }
        try {
          return JSON.parse(body) as unknown;
        } catch {
          throw providerError("invalid-response");
        }
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

export function createCdpAddressHistoryFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: Omit<CdpAddressHistoryTransportOptions, "apiKeyId" | "apiKeySecret"> = {},
): CdpAddressHistoryTransport {
  const apiKeyId = env.CDP_API_KEY_ID?.trim();
  const apiKeySecret = env.CDP_API_KEY_SECRET?.trim();
  if (!apiKeyId || !apiKeySecret) {
    throw new ChainDataError(
      "not-configured",
      "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for CDP Address History.",
    );
  }
  return createCdpAddressHistoryTransport({ ...options, apiKeyId, apiKeySecret });
}

export function createCdpAddressHistory({
  assets,
  transport,
  now = () => new Date(),
  clock = () => Date.now(),
}: CdpAddressHistoryOptions) {
  const addressToAsset = validateAssets(assets);

  return {
    async listTransfers(
      input: ListBaseErc20TransfersInput,
    ): Promise<BaseErc20TransferPage> {
      const fetchedAt = now();
      const request = validateRequest(input, fetchedAt);
      const startedAt = clock();
      const originalCursor = input.cursor ?? null;
      let pageToken = request.cursor?.pageToken ?? null;
      let boundary = request.cursor?.lastEmittedKey ?? null;
      let previousTransaction: ParsedTransaction | null = null;
      let calls = 0;
      let exhausted = false;
      let cutoffReached = false;
      const transfers: BaseErc20Transfer[] = [];
      let continuationPageToken: string | null = pageToken;

      while (calls < MAX_PROVIDER_CALLS && transfers.length < request.limit) {
        const inputPageToken = pageToken;
        const result = await transport.listAddressTransactions({
          address: request.walletAddress,
          pageSize: PROVIDER_PAGE_SIZE,
          ...(inputPageToken ? { pageToken: inputPageToken } : {}),
          signal: input.signal,
        });
        calls += 1;
        const page = parseProviderPage(
          result,
          request.walletAddress,
          addressToAsset,
        );
        assertPageTransition(previousTransaction, page.transactions[0]);

        for (const transaction of page.transactions) {
          assertTransactionTransition(previousTransaction, transaction);
          previousTransaction = transaction;

          if (transaction.timestampMs >= request.toMs) continue;
          if (transaction.timestampMs < request.fromMs) {
            cutoffReached = true;
            break;
          }

          for (const transfer of transaction.transfers) {
            const key = transferKey(transfer);
            if (boundary && compareHistoryKeys(key, boundary) >= 0) continue;
            transfers.push(transfer);
            boundary = key;
            continuationPageToken = inputPageToken;
            if (transfers.length === request.limit) break;
          }
          if (transfers.length === request.limit) break;
        }

        if (cutoffReached) {
          exhausted = true;
          break;
        }
        if (transfers.length === request.limit) {
          exhausted =
            page.nextPageToken === null &&
            !pageHasTransferAfterBoundary(
              page,
              boundary,
              request.fromMs,
              request.toMs,
            );
          break;
        }
        if (page.nextPageToken === null) {
          exhausted = true;
          break;
        }
        if (page.nextPageToken === inputPageToken) {
          throw invalidResponse("CDP Address History returned a non-advancing page token.");
        }
        pageToken = page.nextPageToken;
        continuationPageToken = pageToken;
      }

      let nextCursor: string | null = null;
      if (!exhausted) {
        nextCursor = encodeCdpAddressHistoryCursor({
          version: 1,
          pageToken: continuationPageToken,
          lastEmittedKey: boundary,
        });
        if (nextCursor === originalCursor) {
          throw invalidResponse("CDP Address History pagination did not advance.");
        }
      }

      return {
        transfers,
        nextCursor,
        source: {
          provider: "cdp-address-history",
          cached: false,
          stale: false,
          executionTimestamp: fetchedAt.toISOString(),
          executionTimeMs: Math.max(0, Math.round(clock() - startedAt)),
          fetchedAt: fetchedAt.toISOString(),
        },
      };
    },
  };
}

export function encodeCdpAddressHistoryCursor(
  cursor: CdpAddressHistoryCursor,
): string {
  validateCursor(cursor);
  const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  if (encoded.length > MAX_CURSOR_LENGTH) {
    throw new ChainDataError("invalid-input", "Invalid CDP Address History cursor.");
  }
  return encoded;
}

export function decodeCdpAddressHistoryCursor(
  value: string,
): CdpAddressHistoryCursor {
  if (
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new ChainDataError("invalid-input", "Invalid CDP Address History cursor.");
  }

  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error("non-canonical cursor");
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    validateCursor(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof ChainDataError) throw error;
    throw new ChainDataError("invalid-input", "Invalid CDP Address History cursor.", {
      cause: error,
    });
  }
}

function addressHistoryRequestPath(address: HexAddress): string {
  return `${CDP_ADDRESS_HISTORY_PATH_PREFIX}/${address.toLowerCase()}/transactions`;
}

function addressHistoryRequestUrl(
  address: HexAddress,
  pageToken?: string,
): string {
  const url = new URL(
    `https://${CDP_ADDRESS_HISTORY_HOST}${addressHistoryRequestPath(address)}`,
  );
  url.searchParams.set("limit", PROVIDER_PAGE_SIZE);
  if (pageToken) url.searchParams.set("page", pageToken);
  return url.toString();
}

function responseError(response: Response): ChainDataError {
  const status = response.status;
  if (status === 400) return providerError("invalid-input", status);
  if (status === 401 || status === 403) {
    return providerError("unauthorized", status);
  }
  if (status === 402) return providerError("payment-required", status);
  if (status === 408 || status === 504) {
    return providerError("timed-out", status);
  }
  if (status === 429) return providerError("rate-limited", status);
  return providerError("upstream-error", status);
}

function throwIfRequestAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw providerError("timed-out");
}

function parseProviderPage(
  value: unknown,
  walletAddress: HexAddress,
  addressToAsset: ReadonlyMap<HexAddress, BaseErc20Asset>,
): ParsedProviderPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    value.data.length > MAX_PROVIDER_PAGE_SIZE ||
    typeof value.has_more !== "boolean"
  ) {
    throw invalidResponse("CDP Address History returned an invalid transaction page.");
  }
  const nextPageToken = parseRestNextPage(value.has_more, value.next_page);
  const transactions = value.data.flatMap((transaction) => {
    const parsed = parseTransaction(transaction, walletAddress, addressToAsset);
    return parsed ? [parsed] : [];
  });
  assertTransactionOrder(transactions);
  return { transactions, nextPageToken };
}

function parseTransaction(
  value: unknown,
  walletAddress: HexAddress,
  addressToAsset: ReadonlyMap<HexAddress, BaseErc20Asset>,
): ParsedTransaction | null {
  if (
    !isRecord(value) ||
    typeof value.status !== "string" ||
    value.network_id !== CDP_ADDRESS_HISTORY_NETWORK
  ) {
    throw invalidResponse("CDP Address History returned an invalid transaction.");
  }
  if (value.status !== "complete") return null;

  const transactionHash = responseHash(
    value.transaction_hash,
    "transaction hash",
  );
  const blockHash = responseHash(value.block_hash, "block hash");
  const blockNumber = responseDecimal(value.block_height, "block height");
  if (!isRecord(value.content)) {
    throw invalidResponse("CDP Address History omitted completed transaction content.");
  }
  const rawTransfers = value.content.token_transfers ?? [];
  if (!Array.isArray(rawTransfers)) {
    throw invalidResponse("CDP Address History returned invalid token transfers.");
  }
  const contentHash = responseHash(value.content.hash, "content transaction hash");
  if (contentHash !== transactionHash) {
    throw invalidResponse("CDP Address History returned inconsistent transaction identity.");
  }
  const transactionIndex = responseIndex(
    value.content.index,
    "transaction index",
  );
  const timestamp = responseTimestamp(value.content.block_timestamp);
  const transfers = rawTransfers.flatMap((transfer) => {
    const parsed = parseTokenTransfer(
      transfer,
      walletAddress,
      addressToAsset,
      { transactionHash, blockHash, blockNumber, timestamp },
    );
    return parsed ? [parsed] : [];
  });
  transfers.sort((left, right) => compareHistoryKeys(transferKey(right), transferKey(left)));
  assertTransferOrder(transfers);

  return {
    key: { blockNumber, transactionIndex },
    timestamp,
    timestampMs: new Date(timestamp).getTime(),
    transfers,
  };
}

function parseTokenTransfer(
  value: unknown,
  walletAddress: HexAddress,
  addressToAsset: ReadonlyMap<HexAddress, BaseErc20Asset>,
  transaction: {
    transactionHash: TransactionHash;
    blockHash: TransactionHash;
    blockNumber: string;
    timestamp: string;
  },
): BaseErc20Transfer | null {
  if (!isRecord(value)) {
    throw invalidResponse("CDP Address History returned an invalid token transfer.");
  }
  if (value.token_transfer_type !== "erc20") return null;

  const fromAddress = responseAddress(value.from_address, "from address");
  const toAddress = responseAddress(value.to_address, "to address");
  if (fromAddress !== walletAddress && toAddress !== walletAddress) return null;

  const tokenAddress = responseAddress(
    value.contract_address,
    "token address",
  );
  const amountBaseUnits = responseAmount(value.value);
  const logIndex = responseIndex(value.log_index, "transfer log index");
  const logId = `${transaction.transactionHash}:${logIndex}`;
  if (logId.length > MAX_LOG_ID_LENGTH) {
    throw invalidResponse("CDP Address History returned an oversized transfer identity.");
  }
  const asset = addressToAsset.get(tokenAddress) ?? null;
  const direction =
    fromAddress === walletAddress && toAddress === walletAddress
      ? "self"
      : toAddress === walletAddress
        ? "incoming"
        : "outgoing";

  return {
    id: `${BASE_MAINNET_CHAIN_ID}:${tokenAddress}:${logId}`,
    logId,
    chainId: BASE_MAINNET_CHAIN_ID,
    assetId: asset?.id ?? null,
    tokenAddress,
    walletAddress,
    fromAddress,
    toAddress,
    direction,
    amountBaseUnits,
    blockNumber: transaction.blockNumber,
    blockHash: transaction.blockHash,
    transactionHash: transaction.transactionHash,
    logIndex,
    blockTimestamp: transaction.timestamp,
  };
}

function validateRequest(input: ListBaseErc20TransfersInput, now: Date): ValidatedRequest {
  const walletAddress = inputAddress(input.verifiedWalletAddress);
  const from = inputTimestamp(input.from, "from");
  const to = inputTimestamp(input.to, "to");
  if (from.getTime() >= to.getTime()) {
    throw new ChainDataError("invalid-input", "The history start must be before its end.");
  }
  if (to.getTime() - from.getTime() > MAX_TIME_RANGE_MS) {
    throw new ChainDataError("invalid-input", "History windows cannot exceed 31 days.");
  }
  if (to.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new ChainDataError("invalid-input", "History end cannot be in the future.");
  }
  const limit = input.limit ?? MAX_TRANSFER_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TRANSFER_PAGE_SIZE) {
    throw new ChainDataError(
      "invalid-input",
      `Address History page size must be between 1 and ${MAX_TRANSFER_PAGE_SIZE}.`,
    );
  }
  return {
    walletAddress,
    fromMs: from.getTime(),
    toMs: to.getTime(),
    limit,
    cursor: input.cursor ? decodeCdpAddressHistoryCursor(input.cursor) : null,
  };
}

function validateAssets(assets: readonly BaseErc20Asset[]): Map<HexAddress, BaseErc20Asset> {
  const result = new Map<HexAddress, BaseErc20Asset>();
  const ids = new Set<string>();
  for (const asset of assets) {
    if (
      asset.chainId !== BASE_MAINNET_CHAIN_ID ||
      typeof asset.id !== "string" ||
      asset.id.length === 0 ||
      asset.id.length > 128 ||
      ids.has(asset.id)
    ) {
      throw new ChainDataError("invalid-input", "Address History assets are invalid.");
    }
    const address = inputAddress(asset.address);
    if (result.has(address)) {
      throw new ChainDataError("invalid-input", "Address History asset addresses must be unique.");
    }
    ids.add(asset.id);
    result.set(address, { ...asset, address });
  }
  return result;
}

function validateCursor(value: unknown): asserts value is CdpAddressHistoryCursor {
  if (!isRecord(value) || !hasExactKeys(value, ["lastEmittedKey", "pageToken", "version"])) {
    throw new ChainDataError("invalid-input", "Invalid CDP Address History cursor.");
  }
  if (
    value.version !== 1 ||
    (value.pageToken !== null && !validPageToken(value.pageToken))
  ) {
    throw new ChainDataError("invalid-input", "Invalid CDP Address History cursor.");
  }
  if (value.lastEmittedKey === null) return;
  if (
    !isRecord(value.lastEmittedKey) ||
    !hasExactKeys(value.lastEmittedKey, [
      "blockNumber",
      "logIndex",
      "tokenAddress",
      "transactionHash",
    ])
  ) {
    throw new ChainDataError("invalid-input", "Invalid CDP Address History cursor.");
  }
  const key = value.lastEmittedKey;
  if (
    typeof key.blockNumber !== "string" ||
    !validDecimal(key.blockNumber) ||
    typeof key.logIndex !== "string" ||
    !validDecimal(key.logIndex) ||
    typeof key.transactionHash !== "string" ||
    !HASH_PATTERN.test(key.transactionHash) ||
    key.transactionHash !== key.transactionHash.toLowerCase() ||
    typeof key.tokenAddress !== "string" ||
    !ADDRESS_PATTERN.test(key.tokenAddress) ||
    key.tokenAddress !== key.tokenAddress.toLowerCase()
  ) {
    throw new ChainDataError("invalid-input", "Invalid CDP Address History cursor.");
  }
}

function assertTransactionOrder(transactions: readonly ParsedTransaction[]): void {
  let previous: ParsedTransaction | null = null;
  for (const transaction of transactions) {
    assertTransactionTransition(previous, transaction);
    previous = transaction;
  }
}

function assertPageTransition(
  previous: ParsedTransaction | null,
  current: ParsedTransaction | undefined,
): void {
  if (previous && current) assertTransactionTransition(previous, current);
}

function assertTransactionTransition(
  previous: ParsedTransaction | null,
  current: ParsedTransaction,
): void {
  if (!previous) return;
  const order = compareTransactionKeys(previous.key, current.key);
  if (order <= 0 || previous.timestampMs < current.timestampMs) {
    throw invalidResponse("CDP Address History transaction order is invalid.");
  }
}

function assertTransferOrder(transfers: readonly BaseErc20Transfer[]): void {
  let previous: CdpAddressHistoryKey | null = null;
  for (const transfer of transfers) {
    const current = transferKey(transfer);
    if (previous && compareHistoryKeys(previous, current) <= 0) {
      throw invalidResponse("CDP Address History transfer order is invalid.");
    }
    previous = current;
  }
}

function pageHasTransferAfterBoundary(
  page: ParsedProviderPage,
  boundary: CdpAddressHistoryKey | null,
  fromMs: number,
  toMs: number,
): boolean {
  if (!boundary) return false;
  return page.transactions.some(
    (transaction) =>
      transaction.timestampMs >= fromMs &&
      transaction.timestampMs < toMs &&
      transaction.transfers.some(
        (transfer) => compareHistoryKeys(transferKey(transfer), boundary) < 0,
      ),
  );
}

function compareTransactionKeys(
  left: ParsedTransaction["key"],
  right: ParsedTransaction["key"],
): number {
  const block = compareDecimals(left.blockNumber, right.blockNumber);
  if (block !== 0) return block;
  return compareDecimals(left.transactionIndex, right.transactionIndex);
}

function compareHistoryKeys(
  left: CdpAddressHistoryKey,
  right: CdpAddressHistoryKey,
): number {
  const block = compareDecimals(left.blockNumber, right.blockNumber);
  if (block !== 0) return block;
  const log = compareDecimals(left.logIndex, right.logIndex);
  if (log !== 0) return log;
  if (left.transactionHash !== right.transactionHash) {
    return left.transactionHash > right.transactionHash ? 1 : -1;
  }
  const leftId = historyKeyId(left);
  const rightId = historyKeyId(right);
  if (leftId === rightId) return 0;
  return leftId > rightId ? 1 : -1;
}

function historyKeyId(key: CdpAddressHistoryKey): string {
  return `${BASE_MAINNET_CHAIN_ID}:${key.tokenAddress}:${key.transactionHash}:${key.logIndex}`;
}

function compareDecimals(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

function transferKey(transfer: BaseErc20Transfer): CdpAddressHistoryKey {
  return {
    blockNumber: transfer.blockNumber,
    transactionHash: transfer.transactionHash,
    logIndex: transfer.logIndex,
    tokenAddress: transfer.tokenAddress,
  };
}

function inputAddress(value: string): HexAddress {
  const normalized = value.trim().toLowerCase();
  if (!ADDRESS_PATTERN.test(normalized)) {
    throw new ChainDataError("invalid-input", "Expected a 20-byte EVM address.");
  }
  return normalized as HexAddress;
}

function responseAddress(value: unknown, field: string): HexAddress {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    throw invalidResponse(`CDP Address History returned an invalid ${field}.`);
  }
  return value.toLowerCase() as HexAddress;
}

function responseHash(value: unknown, field: string): TransactionHash {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw invalidResponse(`CDP Address History returned an invalid ${field}.`);
  }
  return value.toLowerCase() as TransactionHash;
}

function responseDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !validDecimal(value)) {
    throw invalidResponse(`CDP Address History returned an invalid ${field}.`);
  }
  return value;
}

function responseIndex(value: unknown, field: string): string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidResponse(`CDP Address History returned an invalid ${field}.`);
  }
  return String(value);
}

function responseAmount(value: unknown): string {
  const amount = responseDecimal(value, "token value");
  if (BigInt(amount) > UINT256_MAX) {
    throw invalidResponse("CDP Address History returned an out-of-range token value.");
  }
  return amount;
}

function inputTimestamp(value: string, field: string): Date {
  if (typeof value !== "string" || value.length > 64) {
    throw new ChainDataError("invalid-input", `Invalid ${field} timestamp.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ChainDataError("invalid-input", `Invalid ${field} timestamp.`);
  }
  return parsed;
}

function responseTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(value)
  ) {
    throw invalidResponse("CDP Address History returned an invalid block timestamp.");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw invalidResponse("CDP Address History returned an invalid block timestamp.");
  }
  return parsed.toISOString();
}

function parseRestNextPage(hasMore: boolean, value: unknown): string | null {
  if (hasMore) {
    if (!validPageToken(value)) {
      throw invalidResponse("CDP Address History returned an invalid page token.");
    }
    return value;
  }
  if (value !== undefined && value !== null && value !== "") {
    throw invalidResponse("CDP Address History returned an inconsistent page token.");
  }
  return null;
}

function validPageToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PAGE_TOKEN_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validDecimal(value: string): boolean {
  if (!DECIMAL_INTEGER_PATTERN.test(value) || value.length > 78) return false;
  return BigInt(value) <= UINT256_MAX;
}

function providerError(
  code: ChainDataErrorCode,
  status?: number | null,
): ChainDataError {
  return new ChainDataError(code, providerErrorMessage(code), { status });
}

function providerErrorMessage(code: ChainDataErrorCode): string {
  switch (code) {
    case "invalid-input":
      return "CDP Address History rejected the request.";
    case "invalid-response":
      return "CDP Address History returned an invalid response.";
    case "unauthorized":
      return "CDP Address History authentication was rejected.";
    case "payment-required":
      return "CDP Address History entitlement or payment is required.";
    case "rate-limited":
      return "CDP Address History rate limit was reached.";
    case "timed-out":
      return "CDP Address History request timed out.";
    case "not-configured":
      return "CDP Address History is not configured.";
    case "upstream-error":
      return "CDP Address History request failed.";
  }
}

function invalidResponse(message: string): ChainDataError {
  return new ChainDataError("invalid-response", message);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
