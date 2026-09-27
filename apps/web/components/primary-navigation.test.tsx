import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { PrimaryNavigation } = await import("./primary-navigation");


afterEach(() => {
  cleanup();
});

describe("PrimaryNavigation", () => {
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

  test("uses one navigation and one id for each destination", () => {
    const view = render(<PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />);
    expect(view.getAllByRole("navigation", { name: "Main navigation" })).toHaveLength(1);
    expect(document.querySelectorAll("#home-nav")).toHaveLength(1);
    expect(document.querySelectorAll("#invest-nav")).toHaveLength(1);
  });

  test("keeps Home selected in a nested panel", () => {
    const view = render(<PrimaryNavigation activeNavigation="balances" onNavigate={() => undefined} />);
    expect(view.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    expect(view.getByRole("button", { name: "Invest" }).hasAttribute("aria-current")).toBe(false);
  });

  test("hides the pill and underline from accessibility", () => {
    const view = render(<PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />);
    expect(view.container.querySelector("[data-navigation-pill]")?.getAttribute("aria-hidden")).toBe("true");
    const underline = view.container.querySelector("nav > span:last-child");
    expect(underline?.getAttribute("aria-hidden")).toBe("true");
  });

  for (const [direction, investTransform] of [["ltr", "translateX(100%)"], ["rtl", "translateX(-100%)"]] as const) {
    test(`positions the active pill in ${direction}`, () => {
      const view = render(
        <div style={{ direction }}>
          <PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />
        </div>,
      );
      const pill = view.container.querySelector<HTMLElement>("[data-navigation-pill]");
      expect(pill?.style.transform).toBe("translateX(0%)");
      view.rerender(
        <div style={{ direction }}>
          <PrimaryNavigation activeNavigation="invest" onNavigate={() => undefined} />
        </div>,
      );
      expect(pill?.style.transform).toBe(investTransform);
      view.rerender(
        <div style={{ direction }}>
          <PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />
        </div>,
      );
      expect(pill?.style.transform).toBe("translateX(0%)");
    });
  }
});
