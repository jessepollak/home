import "@/client/account/dom-test-harness";
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { nativeAssetKey } from "@/shared/balances/types";
import { restoreHoldingReturn } from "./restore-holding-return";

const originalObserver = globalThis.MutationObserver;
let notify = () => {};
let disconnected = false;
const disposers: (() => void)[] = [];
beforeEach(() => {
  disconnected = false;
  globalThis.MutationObserver = class extends originalObserver {
    constructor(callback: MutationCallback) { super(callback); notify = () => callback([], this); }
    observe() {}
    disconnect() { disconnected = true; }
  };
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  globalThis.MutationObserver = originalObserver;
});

function pendingReturn() {
  const main = document.createElement("main");
  const section = document.createElement("section");
  section.setAttribute("aria-labelledby", "investments-held-heading");
  section.setAttribute("aria-busy", "true");
  main.append(section);
  const original = document.createElement("button");
  const other = document.createElement("button");
  document.body.append(main, original, other);
  original.focus();
  const button = document.createElement("button");
  const row = document.createElement("span");
  row.setAttribute("data-holding-key", nativeAssetKey());
  button.append(row);
  const scroll = mock(() => {});
  row.scrollIntoView = scroll;
  const settled = mock(() => {});
  const dispose = restoreHoldingReturn(main, nativeAssetKey(), settled);
  disposers.push(dispose);
  const settle = () => { section.append(button); section.setAttribute("aria-busy", "false"); notify(); };
  return { main, original, other, button, scroll, settled, dispose, settle };
}

for (const replacement of ["settings", "owner", "region"]) {
  test(`a late observer notification cannot restore focus or scroll after ${replacement} replacement`, () => {
    const main = document.createElement("main");
    const section = document.createElement("section");
    section.setAttribute("aria-labelledby", "investments-held-heading");
    section.setAttribute("aria-busy", "true");
    main.append(section);
    document.body.append(main);
    const settled = mock(() => {});
    disposers.push(restoreHoldingReturn(main, nativeAssetKey(), settled));
    notify();
    expect(settled).not.toHaveBeenCalled();
    const replacementSection = document.createElement("section");
    if (replacement !== "settings") replacementSection.setAttribute("aria-labelledby", "investments-held-heading");
    section.replaceWith(replacementSection);
    notify();
    expect(disconnected).toBe(true);
    expect(settled).not.toHaveBeenCalled();
  });
}

test("restores focus and scroll with no intervening action and settles exactly once", () => {
  const { button, scroll, settled, settle } = pendingReturn();
  notify();
  expect(settled).not.toHaveBeenCalled();
  settle();
  notify();
  expect(document.activeElement).toBe(button);
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  expect(settled).toHaveBeenCalledTimes(1);
  expect(disconnected).toBe(true);
});

test("focusin before settling preserves the new focus and scroll", () => {
  const { other, button, scroll, settled, settle } = pendingReturn();
  other.focus();
  settle();
  expect(document.activeElement).toBe(other);
  expect(document.activeElement).not.toBe(button);
  expect(scroll).not.toHaveBeenCalled();
  expect(settled).toHaveBeenCalledTimes(1);
});

test("focus moving away and back still skips focus and scroll restoration", () => {
  const { original, other, scroll, settle } = pendingReturn();
  other.focus();
  original.focus();
  settle();
  expect(document.activeElement).toBe(original);
  expect(scroll).not.toHaveBeenCalled();
});

test("blurring the still-mounted focus to the body skips focus and scroll restoration", () => {
  const { original, scroll, settle } = pendingReturn();
  original.blur();
  expect(document.activeElement).toBe(document.body);
  settle();
  expect(document.activeElement).toBe(document.body);
  expect(scroll).not.toHaveBeenCalled();
});

test("focus lost because its element unmounted still restores focus and scroll", () => {
  const { original, button, scroll, settle } = pendingReturn();
  original.remove();
  settle();
  expect(document.activeElement).toBe(button);
  expect(scroll).toHaveBeenCalledTimes(1);
});

for (const type of ["wheel", "touchmove", "pointerdown"]) {
  test(`${type} before settling restores focus without scrolling`, () => {
    const { main, button, scroll, settle } = pendingReturn();
    main.dispatchEvent(new Event(type));
    settle();
    expect(document.activeElement).toBe(button);
    expect(scroll).not.toHaveBeenCalled();
  });
}

for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "]) {
  test(`keydown ${key === " " ? "Space" : key} before settling restores focus without scrolling`, () => {
    const { main, button, scroll, settle } = pendingReturn();
    main.dispatchEvent(new KeyboardEvent("keydown", { key }));
    settle();
    expect(document.activeElement).toBe(button);
    expect(scroll).not.toHaveBeenCalled();
  });
}

test("keydown Shift before settling restores both focus and scroll", () => {
  const { main, button, scroll, settle } = pendingReturn();
  main.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
  settle();
  expect(document.activeElement).toBe(button);
  expect(scroll).toHaveBeenCalledTimes(1);
});

test("disposing before settling removes listeners and ignores late notifications", () => {
  const { main, other, scroll, settled, dispose, settle } = pendingReturn();
  const remove = spyOn(document, "removeEventListener");
  try {
    dispose();
    dispose();
    expect(disconnected).toBe(true);
    expect(remove).toHaveBeenCalledTimes(5);
    for (const type of ["focusin", "wheel", "touchmove", "pointerdown", "keydown"]) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function), true);
    }
    other.focus();
    for (const type of ["wheel", "touchmove", "pointerdown"]) main.dispatchEvent(new Event(type));
    main.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    settle();
    notify();
    expect(document.activeElement).toBe(other);
    expect(scroll).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
  } finally { remove.mockRestore(); }
});
