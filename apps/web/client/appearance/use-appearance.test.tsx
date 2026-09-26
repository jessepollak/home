import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { appearancePreferenceKey } from "@/shared/appearance/preference";
import { appearanceBootScript } from "./boot-script";
import { AppearanceSync, readAppliedAppearance, useAppearance } from "./use-appearance";

const originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
const originalMatchMedia = window.matchMedia;
const originalFrame = window.requestAnimationFrame;

function themeColor() {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
}

function Preference() {
  const { preference, resolvedAppearance, setAppearancePreference } = useAppearance();
  return (
    <>
      <output>{`${preference}:${resolvedAppearance}`}</output>
      {(["light", "dark", "system"] as const).map((value) => (
        <button key={value} onClick={() => {
          document.body.dataset.persisted = String(setAppearancePreference(value));
        }}>{value}</button>
      ))}
    </>
  );
}

function installSystemAppearance(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = (() => ({
    get matches() { return matches; },
    addEventListener: (_event: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_event: string, listener: () => void) => { listeners.delete(listener); },
  })) as unknown as typeof window.matchMedia;
  return (next: boolean) => {
    matches = next;
    act(() => { for (const listener of listeners) listener(); });
  };
}

function runBoot(storage: Pick<Storage, "getItem">, matchMedia?: (query: string) => { matches: boolean }) {
  new Function("window", "document", appearanceBootScript)({ localStorage: storage, matchMedia }, document);
}

afterEach(() => {
  cleanup();
  if (originalStorage) Object.defineProperty(window, "localStorage", originalStorage);
  window.localStorage.clear();
  window.matchMedia = originalMatchMedia;
  window.requestAnimationFrame = originalFrame;
  document.querySelector('meta[name="theme-color"]')?.remove();
  document.documentElement.classList.remove("dark");
  document.head.querySelectorAll("style").forEach((style) => style.remove());
  document.body.removeAttribute("data-persisted");
});

describe("appearance store", () => {
  test("reads the persisted preference again after a new mount", () => {
    installSystemAppearance(true);
    window.localStorage.setItem(appearancePreferenceKey, "light");
    const first = render(<><AppearanceSync /><Preference /></>);
    expect(first.getByRole("status").textContent).toBe("light:light");
    first.unmount();
    window.localStorage.setItem(appearancePreferenceKey, "dark");
    const second = render(<><AppearanceSync /><Preference /></>);
    expect(second.getByRole("status").textContent).toBe("dark:dark");
    fireEvent.click(second.getByRole("button", { name: "system" }));
    expect(second.getByRole("status").textContent).toBe("system:dark");
    expect(window.localStorage.getItem(appearancePreferenceKey)).toBe("system");
    expect(document.body.dataset.persisted).toBe("true");
  });

  test("keeps an in-memory choice and applies it when storage throws", () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#ffffff">');
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw Error("blocked"); } });
    installSystemAppearance(false);
    const view = render(<><AppearanceSync /><Preference /></>);
    expect(view.getByRole("status").textContent).toBe("system:light");
    fireEvent.click(view.getByRole("button", { name: "dark" }));
    expect(view.getByRole("status").textContent).toBe("dark:dark");
    expect(document.body.dataset.persisted).toBe("false");
    expect(readAppliedAppearance()).toBe("dark");
    expect(themeColor()).toBe("#171717");
    if (originalStorage) Object.defineProperty(window, "localStorage", originalStorage);
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: appearancePreferenceKey })); });
  });

  test("follows OS changes only under system and resumes on returning to system", () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#ffffff">');
    const changeSystem = installSystemAppearance(false);
    const frames: FrameRequestCallback[] = [];
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const view = render(<><AppearanceSync /><Preference /></>);
    changeSystem(true);
    expect(view.getByRole("status").textContent).toBe("system:dark");
    expect(themeColor()).toBe("#171717");
    fireEvent.click(view.getByRole("button", { name: "light" }));
    changeSystem(false);
    changeSystem(true);
    expect(view.getByRole("status").textContent).toBe("light:light");
    expect(themeColor()).toBe("#ffffff");
    fireEvent.click(view.getByRole("button", { name: "system" }));
    expect(view.getByRole("status").textContent).toBe("system:dark");
    expect(themeColor()).toBe("#171717");
    expect(document.head.querySelectorAll("style").length).toBeGreaterThan(0);
    for (const frame of frames) frame(0);
    expect(document.head.querySelectorAll("style").length).toBe(0);
    changeSystem(false);
    expect(view.getByRole("status").textContent).toBe("system:light");
  });

  test("cross-tab storage events replace the current choice", () => {
    installSystemAppearance(false);
    const view = render(<Preference />);
    fireEvent.click(view.getByRole("button", { name: "dark" }));
    window.localStorage.setItem(appearancePreferenceKey, "light");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: appearancePreferenceKey })); });
    expect(view.getByRole("status").textContent).toBe("light:light");
    expect(readAppliedAppearance()).toBe("light");
  });
});

describe("applied appearance", () => {
  test("hook consumers follow a root theme applied outside the store", async () => {
    installSystemAppearance(false);
    window.localStorage.setItem(appearancePreferenceKey, "light");
    const view = render(<Preference />);
    expect(view.getByRole("status").textContent).toBe("light:light");
    await act(async () => {
      document.documentElement.classList.add("dark");
      await Promise.resolve();
    });
    expect(view.getByRole("status").textContent).toBe("light:dark");
    await act(async () => {
      document.documentElement.classList.remove("dark");
      await Promise.resolve();
    });
    expect(view.getByRole("status").textContent).toBe("light:light");
  });
});

describe("appearance boot script", () => {
  test("resolves persisted dark before hydration and updates theme color", () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#ffffff">');
    runBoot({ getItem: () => "dark" }, () => ({ matches: false }));
    expect(readAppliedAppearance()).toBe("dark");
    expect(themeColor()).toBe("#171717");
  });

  test("invalid or inaccessible storage follows the OS; missing matchMedia defaults light", () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#ffffff">');
    runBoot({ getItem: () => "invalid" }, () => ({ matches: true }));
    expect(readAppliedAppearance()).toBe("dark");
    runBoot({ getItem: () => { throw Error("blocked"); } }, () => ({ matches: false }));
    expect(readAppliedAppearance()).toBe("light");
    expect(themeColor()).toBe("#ffffff");
    runBoot({ getItem: () => "system" });
    expect(readAppliedAppearance()).toBe("light");
  });
});
