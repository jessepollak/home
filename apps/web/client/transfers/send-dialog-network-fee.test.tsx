import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
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
  expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("0.98");
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

test("send waits for the USDC fee ceiling before Continue or Enter", async () => {
  let resolveReserve!: (value: unknown) => void;
  const reserveResponse = new Promise<unknown>((resolve) => { resolveReserve = resolve; });
  render(<SendDialog open immediate address={address} ownerBoundary="fee-ceiling-pending"
    availableAssets={[{ ...asset, balanceBaseUnits: "1000000", balanceLabel: "$1.00" }]}
    fetchAccountResource={async (path) => path === "/api/actions/network-fee" ? reserveResponse : { version: 1, recipients: [] }}
    prepareMoneyAction={async () => { throw new Error("unexpected prepare"); }}
    resumeMoneyAction={async () => { throw new Error("unexpected resume"); }}
    executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} onClose={() => {}} />);
  const field = page().getByRole("textbox", { name: "Amount" });
  fireEvent.input(field, { target: { value: "0.5" } });
  expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(field, { key: "Enter" });
  expect(page().queryByLabelText("To")).toBeNull();
  await act(async () => { resolveReserve({ version: 1, usdcReserveBaseUnits: "20000" }); });
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(page().getByLabelText("To")).toBeTruthy());
});

test("send explains a failed USDC fee lookup and recovers on Retry", async () => {
  let requests = 0;
  render(<SendDialog open immediate address={address} ownerBoundary="fee-retry-send"
    availableAssets={[{ ...asset, balanceBaseUnits: "1000000", balanceLabel: "$1.00" }]}
    fetchAccountResource={async (path) => {
      if (path !== "/api/actions/network-fee") return { version: 1, recipients: [] };
      requests++;
      if (requests <= 3) throw new Error("network unavailable");
      return { version: 1, usdcReserveBaseUnits: "20000" };
    }}
    prepareMoneyAction={async () => { throw new Error("unexpected prepare"); }}
    resumeMoneyAction={async () => { throw new Error("unexpected resume"); }}
    executeMoneyAction={async (action) => ({ id: action.id, status: "submitted" })} onClose={() => {}} />);
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "0.5" } });
  const alert = await page().findByRole("alert");
  expect(alert.textContent).toContain("Couldn't check the network fee.");
  expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(page().getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(page().queryByRole("alert") === null).toBe(true));
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  expect(requests).toBe(4);
});

test("send explains and blocks an amount above the fee-adjusted balance", async () => {
  renderSend(async () => { throw new Error("unexpected prepare"); });
  await waitFor(() => expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false));
  const field = page().getByRole("textbox", { name: "Amount" });
  fireEvent.input(field, { target: { value: "1" } });
  expect(page().getByText("Only $0.98 available")).toBeTruthy();
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(field, { key: "Enter" });
  expect(page().queryByLabelText("To")).toBeNull();
  fireEvent.input(field, { target: { value: "0.98" } });
  expect(page().getByText("$1.00 available")).toBeTruthy();
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(page().getByLabelText("To")).toBeTruthy());
});

test("send shows the exact unfunded prepare message", async () => {
  renderSend(async () => { throw Object.assign(new Error("unfunded"), { status: 409, code: "NETWORK_FEE_UNFUNDED", serverMessage: "Add USDC to cover the network fee." }); });
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "0.5" } });
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => recipient } });
  fireEvent.click(page().getByRole("button", { name: "Paste address" }));
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  expect((await page().findByRole("alert")).textContent).toBe("Add USDC to cover the network fee.");
});

test("send shows the unavailable prepare message instead of an invalid recipient", async () => {
  renderSend(async () => { throw Object.assign(new Error("unavailable"), { status: 502, code: "NETWORK_FEE_UNAVAILABLE", serverMessage: "The network fee could not be checked. Try again." }); });
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "0.5" } });
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
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
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "0.5" } });
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  fireEvent.click(await page().findByRole("button", { name: /Withdraw \$2\.00.*Peer cash-out.*awaiting-buyer/ }));
  expect(preparedKind).toBe("cash-out-withdraw");
  expect((await page().findByRole("alert")).textContent).toBe("The network fee could not be checked. Try again.");
});
