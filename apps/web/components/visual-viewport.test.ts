import { describe, expect, test } from "bun:test";
import { visualViewportKeyboardFrame, visualViewportKeyboardInset } from "./visual-viewport";

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

describe("visualViewportKeyboardFrame", () => {
  test("reports the visible top and bottom obstruction when the viewport is panned", () => {
    expect(visualViewportKeyboardFrame(800, { height: 500, offsetTop: 100, scale: 1 })).toEqual({ top: 100, inset: 200 });
  });

  test("keeps the top offset when panning consumes the bottom inset", () => {
    expect(visualViewportKeyboardFrame(800, { height: 500, offsetTop: 300, scale: 1 })).toEqual({ top: 300, inset: 0 });
  });

  test("reports no offset without a keyboard", () => {
    expect(visualViewportKeyboardFrame(800, { height: 800, offsetTop: 0, scale: 1 })).toEqual({ top: 0, inset: 0 });
    expect(visualViewportKeyboardFrame(800, { height: 500, offsetTop: 100, scale: 1.2 })).toEqual({ top: 0, inset: 0 });
  });
});
