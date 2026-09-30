import { describe, expect, test } from "bun:test";
import { nextScrollOwner, scopedSavedScroll } from "./use-shell-document-scroll-restoration";

const scrollKey = "__homeShellScrollY";
const ownerKey = "__homeShellScrollOwner";

describe("shell scroll restoration owner scope", () => {
  test("restores only a saved scroll owned by the current verified owner", () => {
    const saved = { [scrollKey]: 420, [ownerKey]: "A" };
    expect(scopedSavedScroll(saved, "A")?.y).toBe(420);
    expect(scopedSavedScroll(saved, "B")).toBeNull();
    expect(scopedSavedScroll(saved, null)).toBeNull();
    expect(scopedSavedScroll({ [scrollKey]: 420 }, "A")).toBeNull();
    expect(scopedSavedScroll({ [scrollKey]: 420, [ownerKey]: null }, null)).toBeNull();
    expect(scopedSavedScroll(null, "A")).toBeNull();
    expect(scopedSavedScroll({ [scrollKey]: -1, [ownerKey]: "A" }, "A")).toBeNull();
  });

  test("keeps the last verified owner and preserves a first verification owned by that owner", () => {
    expect(nextScrollOwner(null, "A", "A")).toEqual({ owner: "A", reset: false, clear: false });
    expect(nextScrollOwner(null, "A", null)).toEqual({ owner: "A", reset: false, clear: true });
    expect(nextScrollOwner("A", null, "A")).toEqual({ owner: "A", reset: false, clear: false });
    expect(nextScrollOwner("A", "A", "A")).toEqual({ owner: "A", reset: false, clear: false });
    expect(nextScrollOwner("A", "B", "A")).toEqual({ owner: "B", reset: true, clear: true });
    expect(nextScrollOwner(null, null, null)).toEqual({ owner: null, reset: false, clear: false });
  });
});
