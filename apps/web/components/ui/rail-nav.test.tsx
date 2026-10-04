import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { LifeBuoy } from "lucide-react";
import { RailNavItem } from "./rail-nav";

afterEach(cleanup);

test("support navigation includes the unread count in its accessible name", () => {
  const { container } = render(<RailNavItem href="/admin/support" label="Support" icon={LifeBuoy} current unreadCount={3} />);
  const link = within(container).getByRole("link", { name: "Support, 3 unread" });
  expect(link.getAttribute("aria-current")).toBe("page");
  expect(link.textContent).toContain("3");
});

test("zero unread keeps the plain navigation name", () => {
  const { container } = render(<RailNavItem href="/admin/support" label="Support" icon={LifeBuoy} unreadCount={0} />);
  expect(within(container).getByRole("link", { name: "Support" })).toBeTruthy();
});
