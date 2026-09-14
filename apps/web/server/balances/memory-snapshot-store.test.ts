import { expect, test } from "bun:test";
import { MemoryBalanceSnapshotStore } from "./memory-snapshot-store";
import { balanceSnapshotStoreContract } from "./snapshot-store.contract";
import { isHostedRuntime } from "./snapshot-store";

let store = new MemoryBalanceSnapshotStore();
balanceSnapshotStoreContract({
  name: "Memory",
  createStore: () => store,
  reset: () => { store = new MemoryBalanceSnapshotStore(); },
});

test("classifies production and preview as hosted runtimes", () => {
  expect(isHostedRuntime({ VERCEL_ENV: "production" })).toBeTrue();
  expect(isHostedRuntime({ VERCEL_ENV: "preview" })).toBeTrue();
  expect(isHostedRuntime({ VERCEL_ENV: "development" })).toBeFalse();
});
