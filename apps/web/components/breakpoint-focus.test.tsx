import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { useBreakpointFocusHandoff } = await import("./breakpoint-focus");
const { PrimaryNavigation } = await import("./primary-navigation");

const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

function ShellFocus() {
  useBreakpointFocusHandoff();
  return (
    <>
      <button data-breakpoint-peer="nav-invest" id="invest-rail-nav">Invest rail</button>
      <button data-breakpoint-peer="nav-invest" id="invest-nav">Invest tab</button>
      <span data-breakpoint-peer="home-mark"><button>Rail mark</button></span>
      <span data-breakpoint-peer="home-mark"><button>Header mark</button></span>
      <button data-breakpoint-peer="account">Rail account</button>
      <div data-breakpoint-peer="account"><button>Header account</button></div>
      <button>Outside</button>
    </>
  );
}

function setup() {
  let desktop = true;
  const listeners = new Set<EventListener>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      if (query !== "(min-width: 64rem)") {
        return { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
      }
      return {
        get matches() { return desktop; },
        addEventListener: (_: string, listener: EventListener) => listeners.add(listener),
        removeEventListener: (_: string, listener: EventListener) => listeners.delete(listener),
      };
    },
  });
  const view = render(<ShellFocus />);
  const railInvest = view.getByRole("button", { name: "Invest rail" });
  const tabInvest = view.getByRole("button", { name: "Invest tab" });
  const railMark = view.getByRole("button", { name: "Rail mark" });
  const headerMark = view.getByRole("button", { name: "Header mark" });
  const railAccount = view.getByRole("button", { name: "Rail account" });
  const headerAccount = view.getByRole("button", { name: "Header account" });
  const outside = view.getByRole("button", { name: "Outside" });
  for (const element of [railInvest, tabInvest, railMark, headerMark, railAccount, headerAccount, outside]) {
    const rail = element === railInvest || element === railMark || element === railAccount;
    Object.defineProperty(element, "getClientRects", { configurable: true, value: () => rail === desktop || element === outside ? [{}] : [] });
  }
  const resize = (nextDesktop: boolean) => act(() => {
    desktop = nextDesktop;
    for (const listener of listeners) listener(new Event("change"));
  });
  const hideWithoutChange = (nextDesktop: boolean) => { desktop = nextDesktop; };
  return { railInvest, tabInvest, railMark, headerMark, railAccount, headerAccount, outside, resize, hideWithoutChange, listeners, unmount: view.unmount };
}

afterEach(() => {
  cleanup();
  if (matchMediaDescriptor) Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
  else Reflect.deleteProperty(window, "matchMedia");
});

describe("breakpoint focus handoff", () => {
  for (const [label, rail, mobile] of [
    ["navigation", "railInvest", "tabInvest"],
    ["Home mark", "railMark", "headerMark"],
    ["account", "railAccount", "headerAccount"],
  ] as const) {
    test(`${label} focus follows the visible counterpart in both directions`, () => {
      const targets = setup();
      targets[rail].focus();
      targets.resize(false);
      expect(document.activeElement).toBe(targets[mobile]);
      targets.resize(true);
      expect(document.activeElement).toBe(targets[rail]);
    });
  }

  test("focused Sidebar toggle hands off to the visible Home tab when expanded or collapsed", () => {
    const { resize } = setup();
    const navigation = render(
      <>
        <PrimaryNavigation layout="rail" activeNavigation="home" onNavigate={() => {}} />
        <PrimaryNavigation activeNavigation="home" onNavigate={() => {}} />
      </>,
    );
    const toggle = navigation.getByRole("button", { name: "Sidebar" });
    const homeTab = navigation.container.querySelector<HTMLButtonElement>("#home-nav")!;
    const homeRail = navigation.container.querySelector<HTMLButtonElement>("#home-rail-nav")!;
    let desktop = true;
    Object.defineProperty(toggle, "getClientRects", { configurable: true, value: () => desktop ? [{}] : [] });
    Object.defineProperty(homeTab, "getClientRects", { configurable: true, value: () => desktop ? [] : [{}] });
    Object.defineProperty(homeRail, "getClientRects", { configurable: true, value: () => desktop ? [{}] : [] });

    for (const collapsed of [false, true]) {
      toggle.focus();
      if (collapsed) fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe(String(!collapsed));
      desktop = false;
      resize(false);
      expect(document.activeElement).toBe(homeTab);
      desktop = true;
      resize(true);
    }
  });

  test("recovers a hidden peer when the browser already moved focus to the body", () => {
    const { railInvest, tabInvest, resize } = setup();
    railInvest.focus();
    Object.defineProperty(railInvest, "getClientRects", { configurable: true, value: () => [] });
    railInvest.blur();
    expect(document.activeElement).toBe(document.body);
    resize(false);
    expect(document.activeElement).toBe(tabInvest);
  });

  test("does not pull focus back after the customer leaves a visible peer", () => {
    const { railInvest, resize } = setup();
    railInvest.focus();
    railInvest.blur();
    resize(false);
    expect(document.activeElement).toBe(document.body);
  });

  test("hands off when the browser blurs the hidden peer before the media change event", async () => {
    const { railInvest, tabInvest, hideWithoutChange } = setup();
    railInvest.focus();
    hideWithoutChange(false);
    await act(async () => {
      railInvest.blur();
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(tabInvest);
  });

  test("leaves non-peer focus alone", () => {
    const { railInvest, outside, resize } = setup();
    railInvest.focus();
    outside.focus();
    resize(false);
    expect(document.activeElement).toBe(outside);
  });

  test("does not move focus to a disabled counterpart", () => {
    const { railInvest, tabInvest, resize } = setup();
    (tabInvest as HTMLButtonElement).disabled = true;
    railInvest.focus();
    resize(false);
    expect(document.activeElement).toBe(railInvest);
  });

  test("falls back to the matching Home tab and the open settings region", () => {
    const { railMark, railAccount, headerMark, headerAccount, resize } = setup();
    const extra = render(
      <>
        <button data-breakpoint-peer="nav-home">Home tab</button>
        <section data-breakpoint-peer="account-settings" tabIndex={-1} aria-label="Account settings" />
      </>,
    );
    const homeTab = extra.getByRole("button", { name: "Home tab" });
    const settings = extra.getByRole("region", { name: "Account settings" });
    for (const element of [homeTab, settings]) {
      Object.defineProperty(element, "getClientRects", { configurable: true, value: () => [{}] });
    }
    for (const element of [headerMark, headerAccount]) {
      Object.defineProperty(element, "getClientRects", { configurable: true, value: () => [] });
    }
    railMark.parentElement?.setAttribute("data-breakpoint-fallback", "nav-home");
    railAccount.setAttribute("data-breakpoint-fallback", "account-settings");

    railMark.focus();
    resize(false);
    expect(document.activeElement).toBe(homeTab);

    resize(true);
    railAccount.focus();
    resize(false);
    expect(document.activeElement).toBe(settings);
  });

  test("removes its media listener on unmount", () => {
    const { listeners, unmount } = setup();
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
