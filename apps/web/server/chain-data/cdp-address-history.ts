import "server-only";

import {
  BaseRpcError,
  baseRpc,
  classifyBaseRpcHost,
  resolveBaseRpcUrl,
  UINT256_MAX,
} from "@/server/chain/rpc";
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
  rpcUrl: string;
  timeoutMs?: number;
  fetch?: CdpAddressHistoryFetch;
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
  key: Pick<CdpAddressHistoryKey, "blockNumber" | "transactionHash">;
  timestamp: string;
  timestampMs: number;
  transfers: BaseErc20Transfer[];
};

type ParsedProviderPage = {
  transactions: ParsedTransaction[];
  nextPageToken: string | null;
};

export function createCdpAddressHistoryTransport({
  rpcUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetch: fetchImplementation = globalThis.fetch,
}: CdpAddressHistoryTransportOptions): CdpAddressHistoryTransport {
  let resolvedUrl: string;
  try {
    resolvedUrl = resolveBaseRpcUrl(rpcUrl);
  } catch {
    throw new ChainDataError(
      "not-configured",
      "CDP Address History requires a valid BASE_RPC_URL.",
    );
  }
  if (classifyBaseRpcHost(resolvedUrl) !== "cdp-node") {
    throw new ChainDataError(
      "not-configured",
      "CDP Address History requires a configured CDP Node BASE_RPC_URL.",
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

  return {
    async listAddressTransactions(request) {
      try {
        return await baseRpc(
          "cdp_listAddressTransactions",
          [{
            address: request.address.toLowerCase(),
            pageSize: PROVIDER_PAGE_SIZE,
            ...(request.pageToken ? { pageToken: request.pageToken } : {}),
          }],
          {
            rpcUrl: resolvedUrl,
            timeoutMs,
            fetchImpl: fetchImplementation,
            signal: request.signal,
          },
        );
      } catch (error) {
        throw mapBaseRpcError(error);
      }
    },
  };
}

export function createCdpAddressHistoryFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: Omit<CdpAddressHistoryTransportOptions, "rpcUrl"> = {},
): CdpAddressHistoryTransport {
  const rpcUrl = env.BASE_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new ChainDataError(
      "not-configured",
      "CDP Address History requires an explicitly configured CDP Node BASE_RPC_URL.",
    );
  }
  return createCdpAddressHistoryTransport({ ...options, rpcUrl });
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

export function mapCdpAddressHistoryStatus(code: number): ChainDataError {
  const mapped: Partial<Record<number, ChainDataErrorCode>> = {
    3: "invalid-input",
    4: "timed-out",
    7: "payment-required",
    8: "rate-limited",
    14: "upstream-error",
    16: "unauthorized",
  };
  return providerError(mapped[code] ?? "upstream-error");
}

function mapBaseRpcError(error: unknown): ChainDataError {
  if (!(error instanceof BaseRpcError)) {
    return providerError("upstream-error");
  }
  // Do not retain BaseRpcError as a cause: JSON-RPC error messages are
  // provider-controlled and may contain details that must not enter logs.
  if (error.code === "aborted") return providerError("timed-out");
  if (error.code === "invalid-response") {
    return providerError("invalid-response");
  }
  if (error.code === "transport") return providerError("upstream-error");
  if (error.code === "rpc") {
    if (error.rpcCode === -32602) return providerError("invalid-input");
    if (error.rpcCode !== null) return mapCdpAddressHistoryStatus(error.rpcCode);
    return providerError("upstream-error");
  }

  const status = error.httpStatus;
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

function parseProviderPage(
  value: unknown,
  walletAddress: HexAddress,
  addressToAsset: ReadonlyMap<HexAddress, BaseErc20Asset>,
): ParsedProviderPage {
  if (!isRecord(value)) {
    throw invalidResponse("CDP Address History returned an invalid result.");
  }
  if (Object.hasOwn(value, "code")) {
    if (!Number.isSafeInteger(value.code) || value.code === 0) {
      throw invalidResponse("CDP Address History returned an invalid status.");
    }
    throw mapCdpAddressHistoryStatus(value.code as number);
  }
  if (
    !Array.isArray(value.addressTransactions) ||
    value.addressTransactions.length > MAX_PROVIDER_PAGE_SIZE
  ) {
    throw invalidResponse("CDP Address History returned an invalid transaction page.");
  }
  const nextPageToken = parsePageToken(value.nextPageToken);
  const transactions = value.addressTransactions.flatMap((transaction) => {
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
  if (!isRecord(value) || typeof value.status !== "string") {
    throw invalidResponse("CDP Address History returned an invalid transaction.");
  }
  if (value.status !== "CONFIRMED") return null;

  const transactionHash = responseHash(value.hash, "transaction hash");
  const blockHash = responseHash(value.blockHash, "block hash");
  const blockNumber = responseDecimal(value.blockHeight, "block height");
  if (!isRecord(value.ethereum) || !Array.isArray(value.ethereum.tokenTransfers)) {
    throw invalidResponse("CDP Address History omitted confirmed Ethereum content.");
  }
  const timestamp = responseTimestamp(value.ethereum.blockTimestamp);
  const transfers = value.ethereum.tokenTransfers.flatMap((transfer) => {
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
    key: { blockNumber, transactionHash },
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
  if (isTypedNftTransfer(value)) return null;

  const fromAddress = responseAddress(value.fromAddress, "from address");
  const toAddress = responseAddress(value.toAddress, "to address");
  if (fromAddress !== walletAddress && toAddress !== walletAddress) return null;

  const tokenAddress = responseAddress(value.tokenAddress, "token address");
  const amountBaseUnits = responseAmount(value.value);
  const transactionHash = responseHash(value.transactionHash, "transfer transaction hash");
  const blockHash = responseHash(value.blockHash, "transfer block hash");
  const blockNumber = responseDecimal(value.blockNumber, "transfer block number");
  const logIndex = responseDecimal(value.logIndex, "transfer log index");
  if (
    transactionHash !== transaction.transactionHash ||
    blockHash !== transaction.blockHash ||
    blockNumber !== transaction.blockNumber
  ) {
    throw invalidResponse("CDP Address History returned inconsistent transfer identity.");
  }

  const logId = `${transactionHash}:${logIndex}`;
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
    blockNumber,
    blockHash,
    transactionHash,
    logIndex,
    blockTimestamp: transaction.timestamp,
  };
}

function isTypedNftTransfer(value: Record<string, unknown>): boolean {
  if (
    Object.hasOwn(value, "erc721") ||
    Object.hasOwn(value, "erc1155") ||
    Object.hasOwn(value, "erc3525") ||
    Object.hasOwn(value, "nft")
  ) {
    return true;
  }
  const type = value.type;
  return typeof type === "string" && /^(?:erc721|erc1155|erc3525|nft)$/i.test(type);
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
  left: Pick<CdpAddressHistoryKey, "blockNumber" | "transactionHash">,
  right: Pick<CdpAddressHistoryKey, "blockNumber" | "transactionHash">,
): number {
  const block = compareDecimals(left.blockNumber, right.blockNumber);
  if (block !== 0) return block;
  if (left.transactionHash === right.transactionHash) return 0;
  return left.transactionHash > right.transactionHash ? 1 : -1;
}

function compareHistoryKeys(
  left: CdpAddressHistoryKey,
  right: CdpAddressHistoryKey,
): number {
  const transaction = compareTransactionKeys(left, right);
  if (transaction !== 0) return transaction;
  const log = compareDecimals(left.logIndex, right.logIndex);
  if (log !== 0) return log;
  if (left.tokenAddress === right.tokenAddress) return 0;
  return left.tokenAddress > right.tokenAddress ? 1 : -1;
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

function parsePageToken(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (!validPageToken(value)) {
    throw invalidResponse("CDP Address History returned an invalid page token.");
  }
  return value;
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

function invalidResponse(message: string, cause?: unknown): ChainDataError {
  return new ChainDataError("invalid-response", message, { cause });
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
