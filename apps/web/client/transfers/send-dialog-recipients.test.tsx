import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { page } from "@/tests/helpers/dom";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { encodeUsdcTransfer, getTransferAsset } from "@/shared/transfers/transfer-helpers";
import { formatAddress } from "@/shared/formatting";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { SendDialog } = await import("./send-dialog");

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

function preparedAction(recipient: `0x${string}`): PreparedMoneyAction {
  return {
    id: ACTION_ID,
    kind: "send",
    title: "Send USDC",
    createdAt: "2026-09-12T12:00:00.000Z",
    expiresAt: "2026-09-12T12:10:00.000Z",
    calls: [{ to: USDC, data: encodeUsdcTransfer(recipient, BigInt(1_000_000)), value: "0" }],
    amounts: [{
      assetId: "usdc",
      symbol: "USDC",
      decimals: 6,
      amountBaseUnits: "1000000",
      direction: "spend",
    }],
    warnings: [`Recipient: ${recipient}`],
    owner: {
      subject: "subject-a",
      address: ACCOUNT,
      chainId: 8453,
      accountProvider: "cdp-embedded",
    },
  };
}

function renderDialog({
  resolves = { "example.base.eth": RECIPIENT },
  recent = [],
  holdNames = [],
}: {
  resolves?: Record<string, `0x${string}`>;
  recent?: ReadonlyArray<{ address: `0x${string}`; name: string | null }>;
  holdNames?: string[];
} = {}) {
  const prepares: Array<{ kind: string; params: unknown }> = [];
  const requested: string[] = [];
  const releases = new Map<string, (value: unknown) => void>();
  const gates = new Map<string, Promise<unknown>>();
  for (const name of holdNames) {
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => { release = resolve; });
    releases.set(name, release);
    gates.set(name, gate);
  }

  render(
    <SendDialog
      open
      immediate
      address={ACCOUNT}
      ownerBoundary="owner-recipients"
      regionId="US"
      availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
      fetchAccountResource={async (url) => {
        requested.push(url);
        if (url === "/api/actions/network-fee") return { version: 1, usdcReserveBaseUnits: "20000" };
        if (url.startsWith("/api/funding/providers")) return { version: 2, direction: "offramp", providers: [] };
        if (url.startsWith("/api/funding/offramp/orders")) return { version: 3, recoveryEligible: false, orders: [] };
        if (url.startsWith("/api/transfers/recent-recipients")) return { version: 1, recipients: recent };
        const name = new URL(url, "https://home.test").searchParams.get("name") ?? "";
        const gate = gates.get(name);
        if (gate) return await gate;
        const address = resolves[name];
        if (!address) throw Object.assign(new Error("unresolved"), { status: 404, code: "RECIPIENT_NAME_UNRESOLVED" });
        return { version: 1, name, address };
      }}
      prepareMoneyAction={async (kind, params) => {
        prepares.push({ kind, params });
        return preparedAction((params as { recipient: `0x${string}` }).recipient);
      }}
      resumeMoneyAction={async () => preparedAction(RECIPIENT)}
      executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" })}
      onClose={() => {}}
    />,
  );
  return { prepares, requested, releases };
}

function sendField(): HTMLInputElement {
  const fields = document.querySelectorAll<HTMLInputElement>("#send-recipient");
  const field = fields[fields.length - 1];
  if (!field) throw new Error("The send destination field is not mounted.");
  return field;
}

async function openDestinationStep() {
  fireEvent.input(page().getByRole("textbox", { name: "Amount" }), { target: { value: "1" } });
  await waitFor(() => expect((page().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(page().getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(sendField()).toBeTruthy());
}

async function pasteRecipient(value: string) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText: async () => value },
  });
  const buttons = document.querySelectorAll('button[aria-label="Paste address"]');
  const paste = buttons[buttons.length - 1];
  if (!paste) throw new Error("The send paste control is not mounted.");
  await act(async () => { fireEvent.click(paste); });
}

function continueButton(): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll("button"))
    .filter((button) => button.textContent?.trim() === "Continue" && button.getAttribute("aria-label") === null);
  const button = buttons[buttons.length - 1];
  if (!button) throw new Error("The send dialog Continue control is not mounted.");
  return button;
}

function resolvedAddressControl(): Element | null {
  const controls = document.querySelectorAll(`button[aria-label="Show full address ${formatAddress(RECIPIENT)}"]`);
  return controls[controls.length - 1] ?? null;
}

describe("SendDialog recipient names", () => {
  test("resolves a Basename, shows the address, and reviews that address", async () => {
    const { prepares } = renderDialog();
    await openDestinationStep();

    await pasteRecipient("EXAMPLE.BASE.ETH");

    await waitFor(() => expect(resolvedAddressControl()).toBeTruthy());
    expect(continueButton().disabled).toBe(false);

    fireEvent.click(continueButton());

    expect(await page().findByRole("button", { name: "Send $1.00" })).toBeTruthy();
    expect(prepares).toEqual([{
      kind: "send",
      params: {
        assetId: "usdc",
        recipient: RECIPIENT,
        amountBaseUnits: "1000000",
        recipientName: "example.base.eth",
      },
    }]);
    const reveal = resolvedAddressControl();
    expect(reveal).toBeTruthy();
    fireEvent.click(reveal!);
    expect(await page().findByLabelText(`Full address ${RECIPIENT}`)).toBeTruthy();
  });

  test("keeps a settled resolution when an edit normalizes to the same name", async () => {
    const { requested } = renderDialog();
    await openDestinationStep();

    await pasteRecipient("example.base.eth");
    await waitFor(() => expect(resolvedAddressControl()).toBeTruthy());
    const nameRequests = () => requested.filter((url) => url.startsWith("/api/transfers/recipient-name"));
    expect(nameRequests()).toHaveLength(1);

    fireEvent.change(sendField(), { target: { value: "EXAMPLE.BASE.ETH " } });

    expect(resolvedAddressControl()).toBeTruthy();
    expect(continueButton().disabled).toBe(false);
    expect(nameRequests()).toHaveLength(1);
  });

  test("shows an actionable inline error and keeps Continue disabled for an unresolved name", async () => {
    renderDialog({ resolves: {} });
    await openDestinationStep();

    await pasteRecipient("missing.base.eth");

    const errors = await page().findAllByRole("alert");
    expect(errors[errors.length - 1]?.textContent)
      .toBe("We couldn't resolve missing.base.eth. Check the name and try again.");
    expect(continueButton().disabled).toBe(true);
  });

  test("ignores a resolution that lands after the recipient changed", async () => {
    const { requested, releases } = renderDialog({ holdNames: ["first.base.eth"] });
    await openDestinationStep();

    await pasteRecipient("first.base.eth");
    await waitFor(() => expect(requested.some((url) => url.includes("first.base.eth"))).toBe(true));

    await pasteRecipient("second.base.eth");
    await waitFor(() => expect(requested.some((url) => url.includes("second.base.eth"))).toBe(true));
    await page().findAllByRole("alert");

    await act(async () => {
      releases.get("first.base.eth")!({ version: 1, name: "first.base.eth", address: RECIPIENT });
    });
    await waitFor(() => expect(resolvedAddressControl()).toBeNull());
    expect(continueButton().disabled).toBe(true);
  });

  test("fills To from a recent recipient labelled by name or truncated address", async () => {
    renderDialog({
      recent: [
        { address: RECIPIENT, name: "example.base.eth" },
        { address: OTHER, name: null },
      ],
    });
    await openDestinationStep();

    expect(document.body.textContent).toContain("Recent recipients");
    const named = await page().findByRole("button", { name: /example\.base\.eth/ });
    expect(document.body.textContent).toContain(formatAddress(OTHER));

    fireEvent.click(named);

    expect(sendField().value).toBe(formatAddress(RECIPIENT));
    expect(continueButton().disabled).toBe(false);
  });

  test("keeps a raw address send unchanged and explains unsupported input", async () => {
    const { prepares } = renderDialog();
    await openDestinationStep();

    await pasteRecipient("example");
    await waitFor(() => expect(document.body.textContent)
      .toContain("Enter a 0x address or a name like example.base.eth."));
    expect(continueButton().disabled).toBe(true);

    await pasteRecipient(OTHER);
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    expect(document.body.textContent).not.toContain("Enter a 0x address or a name like example.base.eth.");
    expect(document.body.textContent).not.toContain("We couldn't resolve");

    fireEvent.click(continueButton());

    expect(await page().findByRole("button", { name: "Send $1.00" })).toBeTruthy();
    expect(prepares).toEqual([{
      kind: "send",
      params: { assetId: "usdc", recipient: OTHER, amountBaseUnits: "1000000" },
    }]);
  });

  test("does not refetch recent recipients when reopened for the same owner", async () => {
    const requested: string[] = [];
    const fetchAccountResource = async (url: string) => {
      requested.push(url);
      if (url.startsWith("/api/funding/providers")) return { version: 2, direction: "offramp", providers: [] };
      if (url.startsWith("/api/funding/offramp/orders")) return { version: 3, recoveryEligible: false, orders: [] };
      if (url.startsWith("/api/transfers/recent-recipients")) return { version: 1, recipients: [{ address: RECIPIENT, name: "example.base.eth" }] };
      return {};
    };
    const dialog = (open: boolean) => (
      <SendDialog
        open={open}
        immediate
        address={ACCOUNT}
        ownerBoundary="owner-reopen"
        regionId="US"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "5000000", balanceLabel: "$5.00" }]}
        fetchAccountResource={fetchAccountResource}
        prepareMoneyAction={async (_kind, params) => preparedAction((params as { recipient: `0x${string}` }).recipient)}
        resumeMoneyAction={async () => preparedAction(RECIPIENT)}
        executeMoneyAction={async () => ({ id: ACTION_ID, status: "submitted" as const })}
        onClose={() => {}}
      />
    );
    const { rerender } = render(dialog(true));
    const recentCount = () => requested.filter((url) => url.startsWith("/api/transfers/recent-recipients")).length;
    await waitFor(() => expect(recentCount()).toBe(1));

    await act(async () => { rerender(dialog(false)); });
    await act(async () => { rerender(dialog(true)); });

    expect(recentCount()).toBe(1);
  });

  test("refetches recent recipients after a successful send", async () => {
    const { requested } = renderDialog();
    await openDestinationStep();
    const recentCount = () => requested.filter((url) => url.startsWith("/api/transfers/recent-recipients")).length;
    await waitFor(() => expect(recentCount()).toBe(1));

    await pasteRecipient(OTHER);
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    const sendButton = await page().findByRole("button", { name: "Send $1.00" });

    await act(async () => { fireEvent.click(sendButton); });

    await waitFor(() => expect(recentCount()).toBe(2));
  });
});
