import { mock } from "bun:test";

await mock.module("server-only", () => ({}));
