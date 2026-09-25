import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { SendDialog } = await import("./send-dialog");
const address = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222";
const asset = getTransferAsset("usdc")!;

afterEach(cleanup);

function renderSend(prepareMoneyAction: Parameters<typeof SendDialog>[0]["prepareMoneyAction"]) {
  render(<SendDialog open immediate address={address} ownerBoundary="fee-test"
    availableAssets={[{ ...asset, balanceBaseUnits: "1000000", balanceLabel: "$1.00" }]}
    fetchAccountResource={async (path) => path === "/api/actions/network-fee" ? { version: 1, usdcReserveBaseUnits: "20000" } : { version: 1, recipients: [] }}
    prepareMoneyAction={prepareMoneyAction}
    resumeMoneyAction={async () => { throw new Error("unexpected resume"); }}
    executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} onClose={() => {}} />);
}

test("send Max holds back the USDC reserve without changing available balance", async () => {
  renderSend(async () => { throw new Error("unexpected prepare"); });
  await waitFor(() => expect(page().getByRole("button", { name: "Max" })).toBeTruthy());
  await waitFor(() => expect(document.body.textContent).toContain("available"));
  fireEvent.click(page().getByRole("button", { name: "Max" }));
  const amount = document.querySelector("[data-primary-amount] [data-slot=money-ticker]");
  expect(amount?.getAttribute("aria-label")).toBe("$0.98");
  expect(document.body.textContent).toContain("$1.00 available");
});

test("send Max stays disabled while the USDC fee reserve is loading", async () => {
  render(<SendDialog open immediate address={address} ownerBoundary="fee-pending"
    availableAssets={[{ ...asset, balanceBaseUnits: "1000000", balanceLabel: "$1.00" }]}
    fetchAccountResource={async (path) => path === "/api/actions/network-fee" ? new Promise<never>(() => {}) : { version: 1, recipients: [] }}
    prepareMoneyAction={async () => { throw new Error("unexpected prepare"); }}
    resumeMoneyAction={async () => { throw new Error("unexpected resume"); }}
    executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} onClose={() => {}} />);
  expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(true);
});

test("send shows the exact unfunded prepare message", async () => {
  renderSend(async () => { throw Object.assign(new Error("unfunded"), { status: 409, code: "NETWORK_FEE_UNFUNDED", serverMessage: "Add USDC to cover the network fee." }); });
  fireEvent.click(page().getByRole("button", { name: "1" }));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => recipient } });
  fireEvent.click(page().getByRole("button", { name: "Paste address" }));
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  expect((await page().findByRole("alert")).textContent).toBe("Add USDC to cover the network fee.");
});

test("send shows the unavailable prepare message instead of an invalid recipient", async () => {
  renderSend(async () => { throw Object.assign(new Error("unavailable"), { status: 502, code: "NETWORK_FEE_UNAVAILABLE", serverMessage: "The network fee could not be checked. Try again." }); });
  fireEvent.click(page().getByRole("button", { name: "1" }));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => recipient } });
  fireEvent.click(page().getByRole("button", { name: "Paste address" }));
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  expect((await page().findByRole("alert")).textContent).toBe("The network fee could not be checked. Try again.");
});

test("cash-out withdrawal recovery shows the network fee error instead of a handle error", async () => {
  const order = {
    providerId: "peer", providerName: "Peer", assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6,
    depositId: "0xescrow_7", state: "awaiting-buyer", platform: "cashapp", platformLabel: "Cash App", currency: "USD",
    canonicalHandle: null, amountAtomic: "2000000", remainingAmountAtomic: "2000000", nextActions: ["withdraw"],
  };
  let preparedKind = "";
  render(<SendDialog open immediate address={address} ownerBoundary="fee-withdraw"
    availableAssets={[{ ...asset, balanceBaseUnits: "1000000", balanceLabel: "$1.00" }]}
    fetchAccountResource={async (path) => path.startsWith("/api/funding/offramp/orders")
      ? { version: 3, recoveryEligible: true, orders: [order] }
      : path.startsWith("/api/funding/providers") ? { version: 2, direction: "offramp", providers: [] }
      : path === "/api/actions/network-fee" ? { version: 1, usdcReserveBaseUnits: "20000" } : { version: 1, recipients: [] }}
    prepareMoneyAction={async (kind) => { preparedKind = kind; throw Object.assign(new Error("fee"), { status: 502, code: "NETWORK_FEE_UNAVAILABLE", serverMessage: "The network fee could not be checked. Try again." }); }}
    resumeMoneyAction={async () => { throw new Error("unexpected resume"); }}
    executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} onClose={() => {}} />);
  fireEvent.click(page().getByRole("button", { name: "1" }));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  fireEvent.click(await page().findByRole("button", { name: /Withdraw \$2\.00.*Peer cash-out.*awaiting-buyer/ }));
  expect(preparedKind).toBe("cash-out-withdraw");
  expect((await page().findByRole("alert")).textContent).toBe("The network fee could not be checked. Try again.");
});
