import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { MoneyPositionInput, MoneyPositionSlice } from "./money-position-model";
import {
  BorrowPositionHeaderProposal,
  MoneyPositionProductTiles,
} from "./money-position-proposal";

function slice(
  id: string,
  kind: MoneyPositionSlice["kind"],
  amountMinor: string | null,
  status: MoneyPositionSlice["status"] = "ready",
): MoneyPositionSlice {
  return { id, kind, label: id, detail: `${id} detail`, amountMinor, status };
}

function position(overrides: Partial<MoneyPositionInput> = {}): MoneyPositionInput {
  return {
    currency: "USD",
    quoteCurrencyMinorUnitScale: 2,
    regionId: "US",
    slices: [
      slice("Cash", "cash", "100000"),
      slice("Saved", "saved", "50000"),
      slice("Bitcoin collateral", "collateral", "80000"),
    ],
    debt: {
      label: "Borrowed",
      detail: "USDC debt",
      amountMinor: "70000",
      status: "ready",
    },
    ...overrides,
  };
}

afterEach(cleanup);

describe("BorrowPositionHeaderProposal", () => {
  test("derives position after debt from collateral only", () => {
    const view = render(<BorrowPositionHeaderProposal position={position()} />);
    const positionFact = view.getByText("Position after debt").parentElement;

    expect(positionFact?.textContent).toContain("$100.00");
    expect(positionFact?.textContent).not.toContain("$1,600.00");
  });

  test("withholds the derived position when collateral is unavailable", () => {
    const view = render(
      <BorrowPositionHeaderProposal
        position={position({
          slices: [
            slice("Cash", "cash", "100000"),
            slice("Bitcoin collateral", "collateral", null, "unavailable"),
          ],
        })}
      />,
    );

    expect(view.getByText("Position after debt").parentElement?.textContent)
      .toContain("Unavailable");
  });

  test("labels stale collateral, debt, and the derived position as last verified", () => {
    const view = render(
      <BorrowPositionHeaderProposal
        position={position({
          slices: [
            slice("Cash", "cash", "100000"),
            slice("Bitcoin collateral", "collateral", "80000", "stale"),
          ],
          debt: {
            label: "Borrowed",
            detail: "USDC debt",
            amountMinor: "70000",
            status: "stale",
          },
        })}
      />,
    );

    expect(view.getByText("Borrowed · Last verified")).toBeTruthy();
    expect(view.getByText("Collateral locked · Last verified")).toBeTruthy();
    expect(view.getByText("Position after debt · Last verified").parentElement?.textContent)
      .toContain("$100.00");
  });
});

describe("MoneyPositionProductTiles", () => {
  test("labels stale saved, collateral, and debt values", () => {
    const view = render(
      <MoneyPositionProductTiles
        position={position({
          slices: [
            slice("Saved", "saved", "50000", "stale"),
            slice("Bitcoin collateral", "collateral", "80000", "stale"),
          ],
          debt: {
            label: "Borrowed",
            detail: "USDC debt",
            amountMinor: "70000",
            status: "stale",
          },
        })}
        onOpenSave={() => undefined}
        onOpenBorrow={() => undefined}
      />,
    );

    expect(view.getByRole("button", { name: "Open Save" }).textContent)
      .toContain("Last verified value");
    const borrowTile = view.getByRole("button", { name: "Open Borrow" }).textContent;
    expect(borrowTile).toContain("Debt · Last verified");
    expect(borrowTile).toContain("Collateral · Last verified");
  });
});
