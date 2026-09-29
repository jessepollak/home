import { sessionBody } from "../../tests/browser/fixtures/bodies";

export function syntheticActivity(rows: number, anchor: number) {
const transferCount = rows - Math.floor(rows / 10);
const actionCount = rows - transferCount;
const pageSize = 25;
const wallet = sessionBody.smartAccount.address.toLowerCase();
const recipient = "0x2222222222222222222222222222222222222222";
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ethLike = "0x3333333333333333333333333333333333333333";

const timestamp = (index: number) => new Date(anchor - index * 30_000).toISOString();
const transfers = Array.from({ length: transferCount }, (_, index) => {
  const isUsdc = index % 5 !== 0;
  const address = isUsdc ? token : ethLike;
  const incoming = index % 2 === 0;
  return {
    id: `8453:${address}:profile-${index}`, logId: `profile-${index}`, chainId: 8453,
    assetId: isUsdc ? "usdc" : null, tokenAddress: address,
    tokenSymbol: isUsdc ? "USDC" : "WETHX", tokenDecimals: isUsdc ? 6 : 18,
    tokenImageUrl: isUsdc && index % 13 === 0 ? "https://profile.local/token.svg" : null,
    walletAddress: wallet, fromAddress: incoming ? recipient : wallet,
    toAddress: incoming ? wallet : recipient, direction: incoming ? "incoming" : "outgoing",
    amountBaseUnits: index % 7 === 0 ? (isUsdc ? "1234567891234" : "1234567891234000000000000") : String((index + 1) * 1_000_000),
    blockNumber: String(1_000_000 - index), blockHash: `0x${"ef".repeat(32)}`,
    transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
    logIndex: "0", blockTimestamp: timestamp(index + 1),
    valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
  };
});
const actions = Array.from({ length: actionCount }, (_, index) => {
  const date = timestamp(Math.floor(index * transferCount / Math.max(actionCount, 1)) + 1);
  const kind = index % 4 === 1 ? "cash-out" : "send";
  return {
    id: `11111111-1111-4111-8111-${(index + 1).toString(16).padStart(12, "0")}`,
    provider: "cdp-embedded", kind,
    summary: { title: kind === "send" ? "Send USDC" : "Cash out", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1234567891234", direction: "spend" }], warnings: [], expiresAt: timestamp(0) },
    status: index % 7 === 0 ? "pending" : "confirmed", createdAt: date, confirmedAt: date,
    owner: { subject: sessionBody.user.subject, address: wallet, chainId: 8453, accountProvider: sessionBody.accountProvider },
  };
});
  return { transferCount, actionCount, pageSize, wallet, timestamp, transfers, actions };
}

export function activityPage(data: ReturnType<typeof syntheticActivity>, cursor: string, to: string, currency = "USD") {
  const { transferCount, pageSize, wallet, transfers } = data;
  const startIndex = cursor === "initial" ? 0 : Number(cursor.replace("page-", "")) * pageSize;
  if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex >= Math.max(transferCount, 1) || (cursor !== "initial" && cursor !== `page-${startIndex / pageSize}`)) throw new Error(`Unexpected cursor ${cursor}`);
  return { version: 1, walletAddress: wallet, chainId: 8453, currency,
    window: { from: new Date(Date.parse(to) - 31 * 86400_000).toISOString(), to },
    transfers: transfers.slice(startIndex, startIndex + pageSize),
    nextCursor: startIndex + pageSize < transferCount ? `page-${Math.floor(startIndex / pageSize) + 1}` : null,
    source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
  };
}
