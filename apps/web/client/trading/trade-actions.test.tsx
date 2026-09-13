import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cryptoAssets } from "@/config/invest-assets";

const { cleanup, render } = await import("@testing-library/react");
const { TradeActions } = await import("./trade-actions");

const bitcoin = cryptoAssets.find((asset) => asset.id === "cbbtc")!;

afterEach(cleanup);

describe("TradeActions hosted swap availability", () => {
  test("Buy and Sell stay disabled while hosted swaps are off", () => {
    const view = render(<TradeActions asset={bitcoin} />);

    expect((view.getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
