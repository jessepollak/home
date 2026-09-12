import { afterEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { MemoryMoneyActionStore } from "@/server/money-actions/store";
import {
  GET,
  createRecordedOperationsReader,
  dynamic,
  maxDuration,
  runtime,
} from "./route";

afterEach(() => setObservabilityLogWriterForTests());

describe("GET /api/activity route composition", () => {
  test("uses the Node runtime, stays dynamic, and observes unauthenticated rejection before CDP SQL", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(30);
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => lines.push(line));

    const response = await GET(
      new Request(
        "http://127.0.0.1:3115/api/activity?to=2026-09-07T12%3A00%3A00.000Z",
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("vary")).toBe(
      "Authorization, X-Home-Account-Provider",
    );
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        kind: "activity-read",
        outcome: "rejected",
        reason: "authorization",
        source: "none",
      }),
    ]);
  });

  test("an abort during delayed store acquisition never starts the list", async () => {
    let resolveStore!: (store: MemoryMoneyActionStore) => void;
    const acquisition = new Promise<MemoryMoneyActionStore>((resolve) => {
      resolveStore = resolve;
    });
    let listCalls = 0;
    class InstrumentedStore extends MemoryMoneyActionStore {
      override async list(...args: Parameters<MemoryMoneyActionStore["list"]>) {
        listCalls += 1;
        return super.list(...args);
      }
    }
    const reader = createRecordedOperationsReader(async () => acquisition);
    const controller = new AbortController();
    const reading = reader(
      {
        subject: "fixture-subject",
        address: "0x1111111111111111111111111111111111111111",
        chainId: 8453,
        accountProvider: "cdp-embedded",
      },
      controller.signal,
    );

    controller.abort(new DOMException("fixture abort", "AbortError"));
    await expect(reading).rejects.toHaveProperty("name", "AbortError");
    resolveStore(new InstrumentedStore());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listCalls).toBe(0);
  });
});
