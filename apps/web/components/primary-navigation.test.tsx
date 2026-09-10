import "@/features/account/dom-test-harness";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { PrimaryNavigation } = await import("./primary-navigation");

const css = readFileSync(
  resolve(import.meta.dir, "primary-navigation.module.css"),
  "utf8",
);

afterEach(() => {
  cleanup();
});

describe("PrimaryNavigation — #162 footer lock", () => {
  test("keeps Home and Invest only", () => {
    const view = render(
      <PrimaryNavigation activeNavigation="home" onNavigate={() => {}} />,
    );
    const tabs = view.getByRole("navigation", { name: "Main navigation" });
    const buttons = [...tabs.querySelectorAll("button")].map(
      (button) => button.textContent,
    );
    expect(buttons).toEqual(["Home", "Invest"]);
  });

  test("is full-bleed with only safe-area bottom pad", () => {
    expect(css).not.toContain("padding: 0 12px");
    expect(css).toContain("margin-inline: -16px");
    expect(css).toContain("padding: 0;");
    expect(css).toContain("padding-bottom: env(safe-area-inset-bottom, 0px)");
  });

  test("centers a 56px icon+label stack", () => {
    expect(css).toMatch(/\.item \{[\s\S]*min-height: 56px/);
    expect(css).toMatch(/\.item \{[\s\S]*height: 56px/);
    expect(css).toMatch(/\.item \{[\s\S]*padding: 8px 0/);
    expect(css).toMatch(/\.iconFrame \{[\s\S]*flex-shrink: 0/);
    expect(css).toMatch(/\.iconFrame \{[\s\S]*width: 32px/);
    expect(css).toMatch(/\.iconFrame \{[\s\S]*height: 32px/);
    expect(css).not.toContain("min-height: 61px");
  });

  test("presses the icon frame at 0.94 over 110ms and drops transform when reduced-motion", () => {
    expect(css).toContain(".item:active .iconFrame");
    expect(css).toContain("transform: scale(0.94)");
    expect(css).toContain("transform 110ms ease");
    const reduced = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("transform: none");
    expect(css).not.toContain("ripple");
  });

  test("activates Home for nested Home panels without adding tabs", () => {
    const view = render(
      <PrimaryNavigation activeNavigation="balances" onNavigate={() => {}} />,
    );
    expect(view.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(view.getByRole("button", { name: "Invest" }).getAttribute("aria-current")).toBeNull();
  });

  test("forwards a tap without layout-affecting handlers", () => {
    const navigations: string[] = [];
    const view = render(
      <PrimaryNavigation
        activeNavigation="home"
        onNavigate={(id) => navigations.push(id)}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Invest" }));
    expect(navigations).toEqual(["invest"]);
  });
});
