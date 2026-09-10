import "@/features/account/dom-test-harness";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { ProfileMark } = await import("./profile-mark");

const ADDRESS = "0x1111111111111111111111111111111111111111";
const originalFetch = window.fetch;
const css = readFileSync(resolve(import.meta.dir, "profile-mark.module.css"), "utf8");

afterEach(() => {
  cleanup();
  window.fetch = originalFetch;
});

describe("ProfileMark", () => {
  test("uses a 32px mark in a 44px Account hit target", () => {
    expect(css).toContain("width: 44px");
    expect(css).toContain("height: 44px");
    expect(css).toMatch(/\.mark \{[\s\S]*width: 32px/);
    expect(css).toMatch(/\.mark \{[\s\S]*height: 32px/);
    expect(css).toContain("background: var(--home-gray-100)");
    const view = render(
      <ProfileMark status="ready" ownerKey="jesse@example.test" onClick={() => {}} />,
    );
    const button = view.getByRole("button", { name: "Account" });
    const mark = button.querySelector("[data-profile='glyph']");
    expect(mark).toBeTruthy();
    expect(mark?.textContent).toBe("j");
  });

  test("shimmers while the session is checking, then fails open to a glyph", async () => {
    window.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const loading = render(
      <ProfileMark status="loading" ownerKey="jesse@example.test" disabled />,
    );
    const button = loading.getByRole("button", { name: "Account" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector("[data-shimmer='profile']")).toBeTruthy();
    expect(button.querySelector("[data-profile='shimmer']")).toBeTruthy();
    expect(button.textContent).toBe("");
    loading.unmount();

    const ready = render(
      <ProfileMark
        status="ready"
        ownerKey="jesse@example.test"
        address={ADDRESS}
        onClick={() => {}}
      />,
    );
    await waitFor(() =>
      expect(ready.getByRole("button", { name: "Account" }).textContent).toBe("j"),
    );
    expect(
      ready.getByRole("button", { name: "Account" }).querySelector("[data-profile='glyph']"),
    ).toBeTruthy();
  });

  test("covers the circle with a Basename photo and falls back when it errors", async () => {
    window.fetch = (async () =>
      Response.json({
        name: "jesse.base.eth",
        avatar: "https://example.test/j.png",
      })) as unknown as typeof fetch;

    const view = render(
      <ProfileMark status="ready" ownerKey="other@example.test" address={ADDRESS} />,
    );
    const image = await waitFor(() => {
      const node = view.container.querySelector("img");
      expect(node?.getAttribute("src")).toBe("https://example.test/j.png");
      return node!;
    });
    expect(image.hasAttribute("hidden")).toBe(true);
    fireEvent.load(image);
    expect(view.container.querySelector("[data-profile='photo']")).toBeTruthy();
    expect(view.container.textContent).toBe("");

    fireEvent.error(image);
    expect(view.container.querySelector("[data-profile='glyph']")).toBeTruthy();
    expect(view.container.textContent).toBe("j");
  });
});
