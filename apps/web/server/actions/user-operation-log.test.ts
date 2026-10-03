import { describe, expect, test } from "bun:test";
import { createUserOperationLogLookup } from "./user-operation-log";
import { USER_OPERATION_ENTRY_POINTS, USER_OPERATION_EVENT_TOPIC } from "./receipt";
import type { ActionRow } from "./store";

const handle = `0x${"ab".repeat(32)}`;
const hash = `0x${"cd".repeat(32)}` as `0x${string}`;
const sender = "0x1111111111111111111111111111111111111111";
const confirmedAt = 1_700_000_000_000;
const row = { provider_handle: handle, account_address: sender, confirmed_at: new Date(confirmedAt) } as ActionRow;
const log = (address: string, account = sender) => ({ address, transactionHash: hash,
  topics: [USER_OPERATION_EVENT_TOPIC, handle, `0x${"0".repeat(24)}${account.slice(2)}`] });

function harnessFor(target: ActionRow, logs: unknown[], age: number, head: string) {
  const requests: Array<{ method: string; params: unknown[] }> = [];
  const confirmedMs = (target.confirmed_at as Date).getTime();
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
    requests.push(request);
    return Response.json({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? "0x2105" : request.method === "eth_blockNumber" ? head
        : Array.isArray(logs) ? logs.filter((entry) => {
          if (!entry || typeof entry !== "object" || !("blockNumber" in entry)) return true;
          const range = request.params[0] as { fromBlock: string; toBlock: string };
          const block = BigInt(String(entry.blockNumber));
          return block >= BigInt(range.fromBlock) && block <= BigInt(range.toBlock);
        }) : logs });
  };
  return { requests, lookup: createUserOperationLogLookup({ fetchImpl, now: () => confirmedMs + age }) };
}

function harness(logs: unknown[], age = 60_000, head = "0x1000") {
  return harnessFor(row, logs, age, head);
}

function scannedRanges(requests: Array<{ method: string; params: unknown[] }>) {
  return requests.filter(({ method }) => method === "eth_getLogs")
    .map(({ params }) => params[0] as { fromBlock: string; toBlock: string });
}

describe("user operation log lookup", () => {
  for (const [version, address] of Object.entries(USER_OPERATION_ENTRY_POINTS)) {
    test(`matches canonical ${version} by hash and sender`, async () => {
      const { lookup } = harness([log(address)]);
      expect(await lookup(row)).toMatchObject({ status: "complete", transactionHash: hash, code: `USEROP_LOG_${version}` });
    });
  }
  test("ignores wrong sender and non-EntryPoint logs", async () => {
    const { lookup } = harness([log(USER_OPERATION_ENTRY_POINTS.V06, "0x2222222222222222222222222222222222222222"), log(sender)]);
    expect(await lookup(row)).toEqual({ status: "pending" });
  });
  test("treats an unverifiable topic on a canonical log as unavailable", async () => {
    const { lookup } = harness([{ ...log(USER_OPERATION_ENTRY_POINTS.V06), topics: [{ toLowerCase: 1 }, handle, `0x${"0".repeat(24)}${sender.slice(2)}`] }]);
    expect(await lookup(row)).toEqual({ status: "unavailable" });
  });
  test("refuses a complete match while an unverifiable canonical log could also match", async () => {
    const malformed = { ...log(USER_OPERATION_ENTRY_POINTS.V07), transactionHash: `0x${"ef".repeat(32)}`, topics: [USER_OPERATION_EVENT_TOPIC, handle, { toLowerCase: 1 }] };
    const { lookup } = harness([log(USER_OPERATION_ENTRY_POINTS.V06), malformed]);
    expect(await lookup(row)).toEqual({ status: "unavailable" });
  });
  test("treats a canonical log without a topic array as unavailable", async () => {
    const { lookup } = harness([{ ...log(USER_OPERATION_ENTRY_POINTS.V06), topics: "not-an-array" }]);
    expect(await lookup(row)).toEqual({ status: "unavailable" });
  });
  test("treats a log without a string address as unavailable", async () => {
    const { lookup } = harness([{ address: 42, transactionHash: hash, topics: [USER_OPERATION_EVENT_TOPIC, handle, `0x${"0".repeat(24)}${sender.slice(2)}`] }]);
    expect(await lookup(row)).toEqual({ status: "unavailable" });
  });
  test("treats a canonical log with a malformed topic word as unavailable", async () => {
    const malformed = { ...log(USER_OPERATION_ENTRY_POINTS.V07), transactionHash: `0x${"ef".repeat(32)}`, topics: [USER_OPERATION_EVENT_TOPIC, handle, "0x1234"] };
    const { lookup } = harness([log(USER_OPERATION_ENTRY_POINTS.V06), malformed]);
    expect(await lookup(row)).toEqual({ status: "unavailable" });
  });
  test("refuses multiple attributable logs", async () => {
    const { lookup } = harness([log(USER_OPERATION_ENTRY_POINTS.V06), log(USER_OPERATION_ENTRY_POINTS.V07)]);
    expect(await lookup(row)).toEqual({ status: "unavailable" });
  });
  test("chunks long ranges into at most 1000 blocks", async () => {
    const { lookup, requests } = harness([], 3_500_000);
    expect(await lookup(row)).toEqual({ status: "pending" });
    const ranges = requests.filter(({ method }) => method === "eth_getLogs").map(({ params }) => params[0] as { fromBlock: string; toBlock: string });
    expect(ranges.length).toBe(2);
    for (const range of ranges) expect(Number(BigInt(range.toBlock) - BigInt(range.fromBlock))).toBeLessThan(1000);
    expect(BigInt(ranges[0]!.toBlock) + BigInt(1)).toBe(BigInt(ranges[1]!.fromBlock));
  });
  test("finds a log for an action confirmed three days ago within its first hour", async () => {
    const head = BigInt(0x40000);
    const estimatedConfirm = head - BigInt(3 * 86_400_000 / 2_000);
    const blockNumber = estimatedConfirm + BigInt(1_200);
    const { lookup, requests } = harness([{ ...log(USER_OPERATION_ENTRY_POINTS.V07), blockNumber: `0x${blockNumber.toString(16)}` }],
      3 * 86_400_000, `0x${head.toString(16)}`);
    expect(await lookup(row)).toMatchObject({ status: "complete", transactionHash: hash, code: "USEROP_LOG_V07" });
    const ranges = requests.filter(({ method }) => method === "eth_getLogs").map(({ params }) => params[0] as { fromBlock: string; toBlock: string });
    expect(ranges).toHaveLength(2);
    expect(BigInt(ranges[0]!.fromBlock)).toBe(estimatedConfirm - BigInt(30));
    expect(BigInt(ranges.at(-1)!.toBlock)).toBe(estimatedConfirm + BigInt(1_830));
    for (const range of ranges) expect(BigInt(range.toBlock) - BigInt(range.fromBlock)).toBeLessThan(BigInt(1_000));
  });
  test("never searches a log later than the confirmation hour plus margin", async () => {
    const head = BigInt(0x40000);
    const estimatedConfirm = head - BigInt(3 * 86_400_000 / 2_000);
    const lateBlock = estimatedConfirm + BigInt(1_831);
    const { lookup, requests } = harness([{ ...log(USER_OPERATION_ENTRY_POINTS.V06), blockNumber: `0x${lateBlock.toString(16)}` }],
      3 * 86_400_000, `0x${head.toString(16)}`);
    expect(await lookup(row)).toEqual({ status: "unavailable" });
    const ranges = requests.filter(({ method }) => method === "eth_getLogs").map(({ params }) => params[0] as { fromBlock: string; toBlock: string });
    expect(ranges).toHaveLength(2);
    expect(BigInt(ranges.at(-1)!.toBlock)).toBeLessThan(lateBlock);
  });
  test("rejects actions confirmed beyond a small future skew", async () => {
    const { lookup, requests } = harness([], -60_000);
    expect(await lookup(row)).toEqual({ status: "unavailable" });
    expect(requests).toHaveLength(0);
  });
  test("malformed RPC result remains unresolved", async () => {
    const { lookup } = harness({} as unknown as unknown[]);
    expect(await lookup(row)).toEqual({ status: "unavailable" });
  });

  test("finds a log after a wallet approval left open for hours, from the reference arrival", async () => {
    const head = BigInt(0x40000);
    const openMs = 3 * 3_600_000;
    const estimatedConfirm = head - BigInt((openMs + 60_000) / 2_000);
    const referenceBlock = head - BigInt(30);
    const delayed = { ...row, handle_recorded_at: new Date(confirmedAt + openMs) } as ActionRow;
    const { lookup, requests } = harnessFor(delayed,
      [{ ...log(USER_OPERATION_ENTRY_POINTS.V07), blockNumber: `0x${(referenceBlock + BigInt(1)).toString(16)}` }],
      openMs + 60_000, `0x${head.toString(16)}`);

    expect(await lookup(delayed)).toMatchObject({ status: "complete", code: "USEROP_LOG_V07" });
    const ranges = scannedRanges(requests);
    expect(ranges.some((range) => BigInt(range.fromBlock) <= estimatedConfirm - BigInt(30) && BigInt(range.toBlock) >= estimatedConfirm - BigInt(30))).toBe(true);
    expect(ranges.some((range) => BigInt(range.fromBlock) <= referenceBlock && BigInt(range.toBlock) >= referenceBlock)).toBe(true);
  });

  test("still finds a log near confirmation when the reference is posted hours later", async () => {
    const head = BigInt(0x40000);
    const openMs = 4 * 3_600_000;
    const estimatedConfirm = head - BigInt(openMs / 2_000);
    const late = { ...row, handle_recorded_at: new Date(confirmedAt + openMs) } as ActionRow;
    const { lookup } = harnessFor(late,
      [{ ...log(USER_OPERATION_ENTRY_POINTS.V06), blockNumber: `0x${(estimatedConfirm + BigInt(2)).toString(16)}` }],
      openMs, `0x${head.toString(16)}`);

    expect(await lookup(late)).toMatchObject({ status: "complete", code: "USEROP_LOG_V06" });
  });

  test("finds a log in the tail of the reference window while the confirmation window still has work", async () => {
    const head = BigInt(0x40000);
    const openMs = 3 * 3_600_000;
    const sinceReferenceMs = 70 * 60_000;
    const referenceBlock = head - BigInt(sinceReferenceMs / 2_000);
    const delayed = { ...row, handle_recorded_at: new Date(confirmedAt + openMs) } as ActionRow;
    const { lookup, requests } = harnessFor(delayed,
      [{ ...log(USER_OPERATION_ENTRY_POINTS.V07), blockNumber: `0x${(referenceBlock + BigInt(1_200)).toString(16)}` }],
      openMs + sinceReferenceMs, `0x${head.toString(16)}`);

    expect(await lookup(delayed)).toMatchObject({ status: "complete", code: "USEROP_LOG_V07" });
    const ranges = scannedRanges(requests);
    expect(ranges.length).toBe(3);
    expect(BigInt(ranges[0]!.fromBlock)).toBe(referenceBlock - BigInt(30));
    expect(ranges.some((range) => BigInt(range.fromBlock) <= referenceBlock + BigInt(1_200) && BigInt(range.toBlock) >= referenceBlock + BigInt(1_200))).toBe(true);
  });

  test("finds a log mined in the second half of the confirmation window while the reference window still has work", async () => {
    const head = BigInt(0x40000);
    const openMs = 3 * 3_600_000;
    const sinceReferenceMs = 70 * 60_000;
    const estimatedConfirm = head - BigInt((openMs + sinceReferenceMs) / 2_000);
    const delayed = { ...row, handle_recorded_at: new Date(confirmedAt + openMs) } as ActionRow;
    const { lookup, requests } = harnessFor(delayed,
      [{ ...log(USER_OPERATION_ENTRY_POINTS.V07), blockNumber: `0x${(estimatedConfirm + BigInt(1_200)).toString(16)}` }],
      openMs + sinceReferenceMs, `0x${head.toString(16)}`);

    expect(await lookup(delayed)).toMatchObject({ status: "complete", code: "USEROP_LOG_V07" });
    const ranges = scannedRanges(requests);
    expect(ranges.length).toBe(3);
    expect(ranges.some((range) => BigInt(range.fromBlock) <= estimatedConfirm + BigInt(1_200) && BigInt(range.toBlock) >= estimatedConfirm + BigInt(1_200))).toBe(true);
  });

  test("counts a log seen in both overlapping windows once", async () => {
    const reference = new Date(confirmedAt + 30_000);
    const overlapping = { ...row, handle_recorded_at: reference } as ActionRow;
    const { lookup, requests } = harnessFor(overlapping,
      [{ ...log(USER_OPERATION_ENTRY_POINTS.V06), logIndex: "0x3", blockNumber: "0x1000" }], 60_000, "0x1000");

    expect(await lookup(overlapping)).toMatchObject({ status: "complete", code: "USEROP_LOG_V06" });
    expect(scannedRanges(requests).length).toBe(2);
  });

  test("keeps two genuinely different operations ambiguous", async () => {
    const reference = new Date(confirmedAt + 30_000);
    const overlapping = { ...row, handle_recorded_at: reference } as ActionRow;
    const { lookup } = harnessFor(overlapping,
      [{ ...log(USER_OPERATION_ENTRY_POINTS.V06), logIndex: "0x1", blockNumber: "0x1000" },
       { ...log(USER_OPERATION_ENTRY_POINTS.V07), logIndex: "0x2", blockNumber: "0x1000" }], 60_000, "0x1000");

    expect(await lookup(overlapping)).toEqual({ status: "unavailable" });
  });

  test("does not match a log past the reference hour while that window is still open", async () => {
    const head = BigInt(0x40000);
    const openMs = 2 * 3_600_000;
    const late = { ...row, handle_recorded_at: new Date(confirmedAt + openMs) } as ActionRow;
    const referenceBlock = head - BigInt(30);
    const { lookup } = harnessFor(late,
      [{ ...log(USER_OPERATION_ENTRY_POINTS.V07), blockNumber: `0x${(referenceBlock + BigInt(1_831)).toString(16)}` }],
      openMs + 60_000, `0x${head.toString(16)}`);

    expect(await lookup(late)).toEqual({ status: "pending" });
  });

  test("covers every block of separated confirmation and reference windows within the chunk budget", async () => {
    const head = BigInt(0x40000);
    const openMs = 6 * 3_600_000;
    const late = { ...row, handle_recorded_at: new Date(confirmedAt + openMs) } as ActionRow;
    const { lookup, requests } = harnessFor(late, [], openMs + 3_600_000, `0x${head.toString(16)}`);

    expect(await lookup(late)).toEqual({ status: "pending" });
    const estimatedConfirm = head - BigInt(7 * 3_600_000 / 2_000);
    const referenceBlock = head - BigInt(1_800);
    const ranges = scannedRanges(requests);
    expect(ranges.length).toBe(3);
    for (const block of [estimatedConfirm - BigInt(30), estimatedConfirm + BigInt(1_830), referenceBlock - BigInt(30), referenceBlock]) {
      expect(ranges.some((range) => BigInt(range.fromBlock) <= block && BigInt(range.toBlock) >= block)).toBe(true);
    }
  });

  test("ignores a reference arrival earlier than confirmation", async () => {
    const earlier = { ...row, handle_recorded_at: new Date(confirmedAt - 3_600_000) } as ActionRow;
    const { lookup, requests } = harnessFor(earlier, [log(USER_OPERATION_ENTRY_POINTS.V06)], 60_000, "0x1000");

    expect(await lookup(earlier)).toMatchObject({ status: "complete", code: "USEROP_LOG_V06" });
    const ranges = scannedRanges(requests);
    expect(ranges).toHaveLength(1);
    expect(BigInt(ranges[0]!.fromBlock)).toBe(BigInt(4_036));
  });
});
