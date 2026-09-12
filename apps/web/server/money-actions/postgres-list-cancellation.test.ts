import { describe, expect, test } from "bun:test";
import type { MoneyActionOwner } from "@/shared/money-actions/types";
import { PostgresMoneyActionStore } from "./postgres-store";
import { createFakePostgresExecutor } from "./postgres-sql-test-double";
import {
  moneyActionQueries,
  type SqlExecutor,
  type SqlQueryOptions,
} from "./postgres-sql";

const OWNER: MoneyActionOwner = {
  subject: "fixture-subject",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  accountProvider: "cdp-embedded",
};

describe("PostgreSQL money-action list cancellation", () => {
  test("threads abort and timeout into the in-flight list and settles before rejection", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let settled = false;
    let receivedOptions: SqlQueryOptions | undefined;
    const executor = instrumentList(createFakePostgresExecutor(), (options) => {
      receivedOptions = options;
      markStarted();
      return new Promise((_, reject) => {
        const signal = options?.signal;
        if (!signal) {
          reject(new Error("missing list abort signal"));
          return;
        }
        const abort = () => {
          settled = true;
          reject(signal.reason);
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    });
    const store = new PostgresMoneyActionStore(executor);
    await store.ensureSchema();
    const controller = new AbortController();

    const listing = store.list(OWNER, 50, undefined, {
      signal: controller.signal,
      timeoutMs: 25,
    });
    await started;
    controller.abort(new DOMException("fixture abort", "AbortError"));

    await expect(listing).rejects.toHaveProperty("name", "AbortError");
    expect(settled).toBe(true);
    expect(receivedOptions).toMatchObject({
      signal: controller.signal,
      timeoutMs: 25,
    });
  });
});

function instrumentList(
  delegate: SqlExecutor,
  list: (
    options: SqlQueryOptions | undefined,
  ) => Promise<{ rows: never[]; rowCount: number }>,
): SqlExecutor {
  const wrapped: SqlExecutor = {
    query<Row = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
      options?: SqlQueryOptions,
    ) {
      if (
        text === moneyActionQueries.listOwned ||
        text === moneyActionQueries.listOwnedUnresolvedSends
      ) {
        return list(options) as Promise<{
          rows: Row[];
          rowCount: number;
        }>;
      }
      return delegate.query<Row>(text, values, options);
    },
    transaction<Result>(run: (tx: SqlExecutor) => Promise<Result>) {
      return delegate.transaction((tx) => run(instrumentList(tx, list)));
    },
  };
  return wrapped;
}
