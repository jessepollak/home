import { describe, expect, test } from "bun:test";
import { isTransactionHash, transactionExplorerLink } from "./transaction-explorer";

describe("transaction explorer links", () => {
  test("a user-operation hash never opens the Base transaction explorer", () => {
    const userOperationHash = `0x${"a".repeat(64)}`;
    expect(transactionExplorerLink(`user-operation:${userOperationHash}`)).toBeNull();
    expect(transactionExplorerLink("0x1234")).toBeNull();
  });

  test("a real transaction hash links to its BaseScan transaction page", () => {
    const transactionHash = `0x${"a".repeat(64)}`;
    expect(isTransactionHash(transactionHash)).toBe(true);
    expect(transactionExplorerLink(transactionHash)).toMatchObject({
      href: `https://basescan.org/tx/${transactionHash}`,
      label: "View on explorer",
    });
  });
});
