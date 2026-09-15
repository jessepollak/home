import { describe, expect, test } from "bun:test";
import { AGENTATION_ENDPOINT, shouldRenderAgentation } from "./agentation-gate";

describe("Agentation overlay gate", () => {
  test("renders only in Next.js development mode", () => {
    expect(shouldRenderAgentation("development")).toBe(true);
    expect(shouldRenderAgentation("production")).toBe(false);
    expect(shouldRenderAgentation("test")).toBe(false);
    expect(shouldRenderAgentation(undefined)).toBe(false);
  });

  test("targets the local Agentation sync server endpoint", () => {
    expect(AGENTATION_ENDPOINT).toBe("http://localhost:4747");
  });
});
