import { describe, expect, test } from "bun:test";
import { preferCodexAssetIcon } from "./resolve";

describe("asset icon source priority", () => {
  test("uses Codex first, on-chain metadata second, and letters when neither resolves", () => {
    for (const [codex, onchain, expected] of [
      ["https://images.example.test/codex.png", "https://images.example.test/onchain.png", "https://images.example.test/codex.png"],
      [undefined, "https://images.example.test/onchain.png", "https://images.example.test/onchain.png"],
      [undefined, undefined, null],
    ] as const) {
      expect(preferCodexAssetIcon(codex, onchain)).toBe(expected);
    }
  });
});
