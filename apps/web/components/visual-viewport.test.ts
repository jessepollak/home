import { describe, expect, test } from "bun:test";
import { visualViewportKeyboardInset } from "./visual-viewport";

describe("visualViewportKeyboardInset", () => {
  test("returns zero when the viewport is not occluded", () => {
    expect(visualViewportKeyboardInset(800, { height: 800, offsetTop: 0, scale: 1 })).toBe(0);
  });

  test("returns the keyboard inset when the viewport shrinks", () => {
    expect(visualViewportKeyboardInset(800, { height: 500, offsetTop: 0, scale: 1 })).toBe(300);
  });

  test("ignores a shrink of 60 pixels or less", () => {
    expect(visualViewportKeyboardInset(800, { height: 740, offsetTop: 0, scale: 1 })).toBe(0);
  });

  test("ignores zoomed viewports", () => {
    expect(visualViewportKeyboardInset(800, { height: 500, offsetTop: 0, scale: 1.2 })).toBe(0);
  });

  test("accounts for visual viewport offset from the top", () => {
    expect(visualViewportKeyboardInset(800, { height: 500, offsetTop: 100, scale: 1 })).toBe(200);
  });
});
