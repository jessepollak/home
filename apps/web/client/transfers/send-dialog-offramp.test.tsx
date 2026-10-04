import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import { getHomeQueryClient } from "@/client/query/query-client";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { SendDialog } = await import("./send-dialog");

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const usdc = getTransferAsset("usdc");
if (!usdc) throw new Error("Missing USDC transfer asset");
const balance = { ...usdc, balanceBaseUnits: "5000000", balanceLabel: "$5.00" };
const peer = {
  providerId: "peer", displayName: "Peer", region: "US", assetId: "base:usdc",
  assetSymbol: "USDC", assetDecimals: 6, currency: "USD", direction: "offramp",
  paymentMethods: [{
    id: "cashapp", label: "Cash App", platform: "cashapp", handleHint: "$handle",
    minimumAmountAtomic: "1000000", maximumAmountAtomic: null,
    estimateSemantics: "approximate", etaSemantics: "historical-not-guaranteed", corridorConfirmedBy: "fixture",
  }],
  quotes: false,
  customerSetup: null,
} as const;
const unexpectedAction = async () => { throw new Error("No money action should run while choosing a destination."); };

async function renderDestination(queryOwnerKey: string, providersBody: () => unknown) {
  const requests: string[] = [];
  render(<SendDialog open immediate address={ACCOUNT} queryOwnerKey={queryOwnerKey} availableAssets={[balance]}
    prepareMoneyAction={unexpectedAction} resumeMoneyAction={unexpectedAction} executeMoneyAction={unexpectedAction}
    fetchAccountResource={async (url) => {
      if (url.startsWith("/api/funding/providers")) {
        requests.push(url);
        return providersBody();
      }
      if (url === "/api/actions/network-fee") return { version: 1, usdcReserveBaseUnits: null };
      return { version: 1, recipients: [] };
    }} onClose={() => {}} />);
  fireEvent.change(await page().findByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
  const next = page().getByRole("button", { name: "Continue" });
  await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));
  fireEvent.click(next);
  expect(await page().findByRole("textbox", { name: "To" })).toBeTruthy();
  return requests;
}

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

test.each([
  { name: "stale version", body: { version: FUNDING_PROVIDERS_VERSION + 1, direction: "offramp", providers: [] } },
  { name: "wrong direction", body: { version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [] } },
  { name: "malformed catalog", body: { providers: "x" } },
  { name: "null response", body: null },
  { name: "partial entry", body: { version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [{ providerId: "partial" }] } },
])("offers cash-out retry for $name", async ({ name, body }) => {
  const requests = await renderDestination(`offramp-invalid-${name}`, () => body);
  expect(await page().findByText("Cash out is unavailable right now.")).toBeTruthy();
  expect(page().getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(page().queryByText(/isn't available/)).toBeNull();
  expect(requests).toEqual(["/api/funding/providers?region=US&direction=offramp"]);
});

test("cash-out retry replaces a malformed response with the Peer option", async () => {
  let reads = 0;
  const requests = await renderDestination("offramp-retry", () => ++reads === 1
    ? { providers: "x" }
    : { version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [peer] });
  expect(await page().findByText("Cash out is unavailable right now.")).toBeTruthy();
  fireEvent.click(page().getByRole("button", { name: "Try again" }));
  expect(await page().findByRole("button", { name: /Send to Cash App/ })).toBeTruthy();
  expect(page().queryByText("Cash out is unavailable right now.")).toBeNull();
  expect(page().queryByRole("button", { name: "Try again" })).toBeNull();
  expect(page().queryByText(/isn't available/)).toBeNull();
  expect(requests).toEqual(Array(2).fill("/api/funding/providers?region=US&direction=offramp"));
});

test("a valid empty off-ramp catalog shows country unavailability without retry", async () => {
  const requests = await renderDestination("offramp-empty", () => ({ version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [] }));
  expect(await page().findByText("Cash out isn't available in United States yet.")).toBeTruthy();
  expect(page().queryByText("Cash out is unavailable right now.")).toBeNull();
  expect(page().queryByRole("button", { name: "Try again" })).toBeNull();
  expect(requests).toEqual(["/api/funding/providers?region=US&direction=offramp"]);
});
