import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

import type { AccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { PrimaryNavigation } = await import("./primary-navigation");
const { SupportProvider } = await import("@/client/support/support-provider");
const unusedStream: AccountWalletClient["fetchAccountResponse"] = async () => { throw new Error("Unexpected support stream"); };

const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

afterEach(() => {
  cleanup();
  if (storageDescriptor) Object.defineProperty(window, "localStorage", storageDescriptor);
  window.localStorage.removeItem("home:sidebar:collapsed");
  window.dispatchEvent(new StorageEvent("storage", { key: "home:sidebar:collapsed" }));
});

const account = { status: "ready" as const, ownerKey: "owner.base.eth", address: null, disabled: false };

describe("PrimaryNavigation", () => {
  test("tabs navigate and label nested Home panels without duplicate rail IDs", () => {
    const navigations: string[] = [];
    const view = render(
      <>
        <PrimaryNavigation activeNavigation="cash" onNavigate={(id) => navigations.push(id)} />
        <PrimaryNavigation layout="rail" activeNavigation="cash" onNavigate={(id) => navigations.push(id)} account={account} />
      </>,
    );
    const tabs = view.getAllByRole("navigation", { name: "Main navigation" })[0]!;
    const rail = view.getAllByRole("navigation", { name: "Main navigation" })[1]!;
    expect(within(tabs).getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    expect(within(rail).getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    expect(within(tabs).getByRole("button", { name: "Invest" }).id).toBe("invest-nav");
    expect(within(rail).getByRole("button", { name: "Invest" }).id).toBe("invest-rail-nav");
    fireEvent.click(within(tabs).getByRole("button", { name: "Invest" }));
    fireEvent.click(within(rail).getByRole("button", { name: "Invest" }));
    expect(navigations).toEqual(["invest", "invest"]);
  });

  test("Card appears between Home and Invest only when cards are enabled", () => {
    const navigations: string[] = [];
    const view = render(<PrimaryNavigation activeNavigation="home" onNavigate={(id) => navigations.push(id)} />);
    const names = () => within(view.getByRole("navigation", { name: "Main navigation" })).getAllByRole("button").map((button) => button.textContent);
    expect(names()).toEqual(["Home", "Invest"]);
    view.rerender(<PrimaryNavigation activeNavigation="card" cardsEnabled onNavigate={(id) => navigations.push(id)} />);
    expect(names()).toEqual(["Home", "Card", "Invest"]);
    expect(view.getByRole("button", { name: "Card" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(view.getByRole("button", { name: "Invest" }));
    view.rerender(<PrimaryNavigation layout="rail" activeNavigation="card" cardsEnabled account={account} onNavigate={(id) => navigations.push(id)} />);
    fireEvent.click(view.getByRole("button", { name: "Card" }));
    expect(navigations).toEqual(["invest", "card"]);
  });

  test("rail Account announces unread support messages and shows the unread indicator", async () => {
    const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path) => {
      if (path === "/api/support/summary") return { version: 2, unreadCount: 2 };
      throw new Error(`Unexpected request: ${path}`);
    };
    const view = render(<SupportProvider ownerKey="rail-unread" fetchAccountResource={fetchAccountResource} fetchAccountResponse={unusedStream}>
      <PrimaryNavigation layout="rail" activeNavigation="home" account={account} onNavigate={() => {}} />
    </SupportProvider>);
    expect(await view.findByRole("button", { name: "Account settings, 2 unread support messages" })).toBeTruthy();
    expect(view.container.querySelector("[data-support-unread]")).not.toBeNull();
  });

  test("rail Account remains plain while the summary is pending or fails without data", async () => {
    let rejectSummary: (error: Error) => void = () => {};
    const pending = new Promise<never>((_resolve, reject) => { rejectSummary = reject; });
    const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path) => {
      if (path === "/api/support/summary") return pending;
      throw new Error(`Unexpected request: ${path}`);
    };
    const view = render(<SupportProvider ownerKey="rail-unknown" fetchAccountResource={fetchAccountResource} fetchAccountResponse={unusedStream}>
      <PrimaryNavigation layout="rail" activeNavigation="home" account={account} onNavigate={() => {}} />
    </SupportProvider>);
    expect(view.getByRole("button", { name: "Account settings" })).toBeTruthy();
    expect(view.container.querySelector("[data-support-unread]")).toBeNull();
    await act(async () => { rejectSummary(new Error("Summary unavailable")); });
    await waitFor(() => expect(getHomeQueryClient().getQueryState(ownerQueryKey("rail-unknown", "support-summary"))?.status).toBe("error"));
    expect(view.getByRole("button", { name: "Account settings" })).toBeTruthy();
    expect(view.container.querySelector("[data-support-unread]")).toBeNull();
  });

  test("rail gives Account sole current state, ignores repeat presses and disables it while checking", () => {
    const openers: HTMLButtonElement[] = [];
    const view = render(<PrimaryNavigation layout="rail" activeNavigation="invest" isAccountSettingsOpen account={account} onNavigate={() => {}} onOpenAccount={(opener) => openers.push(opener)} />);
    const navigation = view.getByRole("navigation", { name: "Main navigation" });
    const accountButton = view.getByRole("button", { name: "Account settings" });
    expect(accountButton.getAttribute("aria-current")).toBe("page");
    expect(within(navigation).queryByRole("button", { current: "page" })).toBeNull();
    fireEvent.click(accountButton);
    expect(openers).toEqual([]);
    view.rerender(<PrimaryNavigation layout="rail" activeNavigation="invest" account={account} onNavigate={() => {}} onOpenAccount={(opener) => openers.push(opener)} />);
    fireEvent.click(view.getByRole("button", { name: "Account settings" }));
    expect(openers).toEqual([view.getByRole("button", { name: "Account settings" }) as HTMLButtonElement]);
    view.rerender(<PrimaryNavigation layout="rail" activeNavigation="invest" account={{ ...account, status: "loading", disabled: true }} onNavigate={() => {}} onOpenAccount={(opener) => openers.push(opener)} />);
    expect(view.getByRole("button", { name: "Account settings" }).hasAttribute("disabled")).toBe(true);
  });

  test("collapse retains focus, accessible names and stored state across remount", () => {
    const view = render(<PrimaryNavigation layout="rail" activeNavigation="home" account={account} onNavigate={() => {}} />);
    const toggle = view.getByRole("button", { name: "Sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("desktop-rail");
    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(view.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    expect(view.getByRole("button", { name: "Account settings" })).toBeTruthy();
    expect(window.localStorage.getItem("home:sidebar:collapsed")).toBe("true");
    view.unmount();
    const remounted = render(<PrimaryNavigation layout="rail" activeNavigation="invest" account={account} onNavigate={() => {}} />);
    expect(remounted.getByRole("button", { name: "Sidebar" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(remounted.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Invest" }).getAttribute("aria-current")).toBe("page");
  });

  test("a stored collapsed rail restores without animating and animates only on toggle", () => {
    window.localStorage.setItem("home:sidebar:collapsed", "true");
    const view = render(<PrimaryNavigation layout="rail" activeNavigation="home" account={account} onNavigate={() => {}} />);
    const rail = view.container.querySelector("#desktop-rail");
    expect(rail?.getAttribute("data-rail-state")).toBe("collapsed");
    expect(rail?.getAttribute("data-rail-motion")).toBe("static");
    fireEvent.click(view.getByRole("button", { name: "Sidebar" }));
    expect(rail?.getAttribute("data-rail-state")).toBe("expanded");
    expect(rail?.getAttribute("data-rail-motion")).toBe("animated");
  });

  test("blocked storage starts expanded and collapse works in memory", () => {
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("storage denied"); } });
    window.dispatchEvent(new StorageEvent("storage", { key: "home:sidebar:collapsed" }));
    const view = render(<PrimaryNavigation layout="rail" activeNavigation="home" account={account} onNavigate={() => {}} />);
    const toggle = view.getByRole("button", { name: "Sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
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

  test("hides the capsule floor and pill from accessibility", () => {
    const view = render(<PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />);
    expect(view.container.querySelector("[data-navigation-pill]")?.getAttribute("aria-hidden")).toBe("true");
    expect(view.container.querySelector("nav > span:first-child")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("reads the computed direction only when the pill moves off the first tab", () => {
    const original = window.getComputedStyle;
    let reads = 0;
    window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
      reads += 1;
      return original.call(window, element, pseudo);
    }) as typeof window.getComputedStyle;
    try {
      const view = render(<PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />);
      view.rerender(<PrimaryNavigation activeNavigation="cash" onNavigate={() => undefined} />);
      view.rerender(<PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />);
      expect(reads).toBe(0);
      view.rerender(<PrimaryNavigation activeNavigation="invest" onNavigate={() => undefined} />);
      expect(reads).toBe(1);
      view.rerender(<PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />);
      view.rerender(<PrimaryNavigation activeNavigation="balances" onNavigate={() => undefined} />);
      expect(reads).toBe(1);
    } finally {
      window.getComputedStyle = original;
    }
  });

  test("follows a direction change on the same navigation", () => {
    const view = render(
      <div style={{ direction: "ltr" }}>
        <PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />
      </div>,
    );
    const pill = view.container.querySelector<HTMLElement>("[data-navigation-pill]");
    view.rerender(
      <div style={{ direction: "rtl" }}>
        <PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />
      </div>,
    );
    view.rerender(
      <div style={{ direction: "rtl" }}>
        <PrimaryNavigation activeNavigation="invest" onNavigate={() => undefined} />
      </div>,
    );
    expect(pill?.style.transform).toBe("translateX(-100%)");
  });

  for (const direction of ["ltr", "rtl"] as const) {
    test(`selects the active destination in ${direction}`, () => {
      const view = render(
        <div style={{ direction }}>
          <PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />
        </div>,
      );
      expect(view.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
      view.rerender(
        <div style={{ direction }}>
          <PrimaryNavigation activeNavigation="invest" onNavigate={() => undefined} />
        </div>,
      );
      expect(view.getByRole("button", { name: "Invest" }).getAttribute("aria-current")).toBe("page");
      expect(view.getByRole("button", { name: "Home" }).hasAttribute("aria-current")).toBe(false);
      view.rerender(
        <div style={{ direction }}>
          <PrimaryNavigation activeNavigation="home" onNavigate={() => undefined} />
        </div>,
      );
      expect(view.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    });
  }
});
