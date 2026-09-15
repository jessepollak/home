import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { BalanceRowModel } from "@/shared/balances/present";
import { useBalancesRevealWindow } from "./balances-panel";

afterEach(cleanup);

function rows(count: number, revision = 0): BalanceRowModel[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `row-${index}`,
    group: index === 0 ? "cash" : "asset",
    name: `Asset ${index} revision ${revision}`,
    mark: { kind: "symbol", symbol: `A${index}` },
    primary: `$${index + revision}.00`,
    secondary: revision ? `updated ${revision}` : null,
    tone: "default",
  }));
}

function Probe({ scope, models, resetSignal = 0 }: {
  scope: string | null; models: BalanceRowModel[]; resetSignal?: number;
}) {
  const reveal = useBalancesRevealWindow(scope, models, resetSignal);
  return <button type="button" onClick={reveal.extend}>{reveal.count}</button>;
}

describe("useBalancesRevealWindow", () => {
  test("preserves extension through volatile rows and resets only for scope or signal", () => {
    const view = render(<Probe scope="owner-a" models={rows(25)} />);
    const count = () => view.getByRole("button").textContent;
    expect(count()).toBe("10");
    fireEvent.click(view.getByRole("button"));
    expect(count()).toBe("20");
    const refreshed = rows(26, 1).reverse();
    view.rerender(<Probe scope="owner-a" models={refreshed} />);
    expect(count()).toBe("20");
    view.rerender(<Probe scope="owner-a" models={refreshed.slice(0, 8)} />);
    expect(count()).toBe("8");
    view.rerender(<Probe scope="owner-a" models={refreshed} />);
    expect(count()).toBe("20");
    view.rerender(<Probe scope={null} models={refreshed} />);
    expect(count()).toBe("20");
    view.rerender(<Probe scope="owner-b" models={refreshed} />);
    expect(count()).toBe("10");
    fireEvent.click(view.getByRole("button"));
    expect(count()).toBe("20");
    view.rerender(<Probe scope="owner-b" models={refreshed} resetSignal={1} />);
    expect(count()).toBe("10");
  });
});
