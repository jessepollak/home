import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, spyOn, test } from "bun:test";

const { cleanup, fireEvent, render, screen } = await import(
  "@testing-library/react"
);
const { HomeMark } = await import("./home-mark");

afterEach(cleanup);

describe("HomeMark", () => {
  test("preserves link props and the constant Home name with decorative artwork", () => {
    render(<HomeMark href="/dashboard" className="caller-class" data-testid="home-mark" />);

    const link = screen.getByRole("link", { name: "Home" });
    expect(link.getAttribute("href")).toBe("/dashboard");
    expect(link.classList.contains("caller-class")).toBe(true);
    expect(link.getAttribute("data-testid")).toBe("home-mark");
    expect(Array.from(link.children).every((child) => child.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  test("preserves a focusable native button and caller activation", () => {
    let clicks = 0;
    render(<HomeMark onClick={() => clicks++} />);

    const button = screen.getByRole("button", { name: "Home" });
    expect(button.getAttribute("type")).toBe("button");
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(clicks).toBe(1);
  });

  test("keeps instances scoped and removes their hover listeners on unmount", () => {
    const { container, unmount } = render(<><HomeMark href="/" /><HomeMark href="/dashboard" /></>);
    const links = screen.getAllByRole("link", { name: "Home" });
    const removals = links.map((link) => spyOn(link, "removeEventListener"));
    expect(container.querySelectorAll("[id]").length).toBe(0);

    unmount();
    for (const remove of removals) {
      expect(remove).toHaveBeenCalledWith("mouseenter", expect.any(Function));
      expect(remove).toHaveBeenCalledWith("mouseleave", expect.any(Function));
      remove.mockRestore();
    }
  });
});
