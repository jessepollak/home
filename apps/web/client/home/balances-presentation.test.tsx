import "@/client/account/dom-test-harness";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { buildBalancesSnapshotFixture, priced, ready, walletHolding } from "@/shared/balances/fixtures";
import type { BalancesState } from "@/shared/balances/types";
import { useBalancesPresentation } from "./balances-panel";

afterEach(cleanup);

function Probe({ state, active }: { state: BalancesState; active: boolean }) {
  const presentation = useBalancesPresentation({ state, active, showSmallBalances: false });
  return <output>{presentation.status}:{presentation.rows.map((row) => row.name).join(",")}:{presentation.revalidating ? "refreshing" : "settled"}</output>;
}

describe("active Balances presentation", () => {
  test("skips hidden snapshots and unchanged refreshes, then uses the latest snapshot on return", () => {
    let nameReads = 0;
    const asset = walletHolding({ address: "0x1111111111111111111111111111111111111111", name: "Owned asset", symbol: "OWN", decimals: 18 }, "1000000000000000000", priced("USD", "100"));
    const snapshot = buildBalancesSnapshotFixture({ catalog: [asset] });
    Object.defineProperty(asset, "name", { get() { nameReads += 1; return "Owned asset"; } });
    const state: BalancesState = { status: "ready", snapshot, error: null };
    const view = render(<Probe state={state} active={false} />);
    expect(nameReads).toBe(0);
    expect(view.getByRole("status").textContent).toBe("loading::settled");
    view.rerender(<Probe state={state} active />);
    expect(view.getByRole("status").textContent).toContain("Owned asset");
    expect(nameReads).toBeGreaterThan(0);
    nameReads = 0;
    view.rerender(<Probe state={{ ...state, revalidating: true }} active />);
    expect(view.getByRole("status").textContent).toContain("refreshing");
    view.rerender(<Probe state={{ ...state }} active />);
    expect(nameReads).toBe(0);
    view.rerender(<Probe state={state} active={false} />);
    const replacement = buildBalancesSnapshotFixture({ registry: { usdc: { balance: ready("5000000"), value: priced("USD", "500") } } });
    view.rerender(<Probe state={{ status: "ready", snapshot: replacement, error: null }} active={false} />);
    expect(nameReads).toBe(0);
    view.rerender(<Probe state={{ status: "ready", snapshot: replacement, error: null }} active />);
    expect(view.getByRole("status").textContent).not.toContain("Owned asset");
    expect(view.getByRole("status").textContent).toContain("US dollar");
  });

  test("clears prior rows on loading, failure and owner replacement", () => {
    const snapshot = buildBalancesSnapshotFixture({ catalog: [walletHolding({
      address: "0x1111111111111111111111111111111111111111", name: "Owner A asset", symbol: "A", decimals: 18,
    }, "1", priced("USD", "100"))] });
    const view = render(<Probe state={{ status: "ready", snapshot, error: null }} active />);
    expect(view.getByRole("status").textContent).toContain("Owner A asset");
    view.rerender(<Probe state={{ status: "loading", snapshot: null, error: null }} active />);
    expect(view.getByRole("status").textContent).toBe("loading::settled");
    view.rerender(<Probe state={{ status: "error", snapshot: null, error: "balances-unavailable" }} active />);
    expect(view.getByRole("status").textContent).toBe("unavailable::settled");
    const ownerB = buildBalancesSnapshotFixture({ owner: "0x2222222222222222222222222222222222222222" });
    view.rerender(<Probe state={{ status: "ready", snapshot: ownerB, error: null }} active />);
    expect(view.getByRole("status").textContent).not.toContain("Owner A asset");
  });
});
