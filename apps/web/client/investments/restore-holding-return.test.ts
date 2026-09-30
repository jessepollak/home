import "@/client/account/dom-test-harness";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { nativeAssetKey } from "@/shared/balances/types";
import { restoreHoldingReturn } from "./restore-holding-return";

const originalObserver = globalThis.MutationObserver;
let notify = () => {};
let disconnected = false;
beforeEach(() => {
  disconnected = false;
  globalThis.MutationObserver = class extends originalObserver {
    constructor(callback: MutationCallback) { super(callback); notify = () => callback([], this); }
    observe() {}
    disconnect() { disconnected = true; }
  };
});
afterEach(() => { globalThis.MutationObserver = originalObserver; });

for (const replacement of ["settings", "owner", "region"]) {
  test(`a late observer notification cannot restore focus or scroll after ${replacement} replacement`, () => {
    const main = document.createElement("main");
    const section = document.createElement("section");
    section.setAttribute("aria-labelledby", "investments-held-heading");
    section.setAttribute("aria-busy", "true");
    main.append(section);
    document.body.append(main);
    const restored = mock(() => {});
    restoreHoldingReturn(main, nativeAssetKey(), restored);
    notify();
    expect(restored).not.toHaveBeenCalled();
    const replacementSection = document.createElement("section");
    if (replacement !== "settings") replacementSection.setAttribute("aria-labelledby", "investments-held-heading");
    section.replaceWith(replacementSection);
    notify();
    expect(disconnected).toBe(true);
    expect(restored).not.toHaveBeenCalled();
  });
}
