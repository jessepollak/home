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
});
