import { describe } from "bun:test";
import { describeMoneyActionStore } from "./store-contract";
import { MemoryMoneyActionStore } from "./store";

describe("durable money action claims", () => {
  describeMoneyActionStore("MemoryMoneyActionStore test double", () => new MemoryMoneyActionStore());
});
