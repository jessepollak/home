import { useCallback, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@/components/ui/button";
import { SendDialog } from "@/client/transfers/send-dialog";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const journey = { prepares: [] as Array<{ kind: string; params: unknown }> };

type KeyboardViewport = VisualViewport & { height: number; offsetTop: number; scale: number; width: number };
let keyboardViewport: KeyboardViewport;

function setKeyboardHeight(height: number) {
  keyboardViewport.height = height;
  keyboardViewport.dispatchEvent(new Event("resize"));
}

function installKeyboardViewport() {
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
  keyboardViewport = Object.assign(new EventTarget(), {
    height: window.innerHeight,
    offsetTop: 0,
    scale: 1,
    width: window.innerWidth,
  }) as KeyboardViewport;
  Object.defineProperty(window, "visualViewport", { configurable: true, value: keyboardViewport });
  return () => {
    if (original) Object.defineProperty(window, "visualViewport", original);
    else Reflect.deleteProperty(window, "visualViewport");
  };
}

function preparedAction(amountBaseUnits: string): PreparedMoneyAction {
  return {
    id: ACTION_ID,
    kind: "send",
    title: "Send USDC",
    createdAt: "2099-09-12T12:00:00.000Z",
    expiresAt: "2099-09-12T12:10:00.000Z",
    calls: [],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits, direction: "spend" }],
    warnings: [`Recipient: ${RECIPIENT}`],
    owner: { subject: "storybook-send-keyboard", address: ACCOUNT, chainId: 8453, accountProvider: "cdp-embedded" },
  };
}

function SendKeyboardJourney() {
  const [open, setOpen] = useState(false);
  const fetchAccountResource = useCallback<AccountWalletClient["fetchAccountResource"]>(async (url) => {
    if (url.startsWith("/api/funding/providers")) return { version: 2, direction: "offramp", providers: [] };
    if (url.startsWith("/api/funding/offramp/orders")) return { version: 3, recoveryEligible: false, orders: [] };
    if (url.startsWith("/api/transfers/recent-recipients")) return { version: 1, recipients: [] };
    if (url.startsWith("/api/actions/network-fee")) return { version: 1, usdcReserveBaseUnits: null };
    throw new Error(`Unexpected account resource: ${url}`);
  }, []);
  return (
    <main className="flex min-h-dvh flex-col gap-4 p-4">
      <Button size="touch" variant="outline" onClick={() => setOpen(true)}>Send</Button>
      {Array.from({ length: 24 }, (_, index) => <p key={index} className="text-muted-foreground">Activity row {index + 1}</p>)}
      <SendDialog
        open={open}
        address={ACCOUNT}
        ownerBoundary="storybook-send-keyboard"
        regionId="US"
        availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "25000000", balanceLabel: "$25.00" }]}
        fetchAccountResource={fetchAccountResource}
        prepareMoneyAction={async (kind, params) => {
          journey.prepares.push({ kind, params });
          return preparedAction((params as { amountBaseUnits: string }).amountBaseUnits);
        }}
        resumeMoneyAction={async () => new Promise<PreparedMoneyAction>(() => {})}
        executeMoneyAction={async () => new Promise<never>(() => {})}
        onClose={() => setOpen(false)}
      />
    </main>
  );
}

const meta = {
  id: "journeys-money-sheet-keyboard",
  title: "Journeys/Money Sheet Keyboard",
  component: SendKeyboardJourney,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
  beforeEach: () => {
    journey.prepares.length = 0;
  },
} satisfies Meta<typeof SendKeyboardJourney>;

export default meta;
type Story = StoryObj<typeof meta>;

type Screen = ReturnType<typeof within>;

function storyScreen(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

async function openAmount(screen: Screen) {
  const trigger = screen.getByRole("button", { name: "Send" });
  await userEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Send" });
  const amount = within(dialog).getByRole("textbox", { name: "Amount" });
  await waitFor(() => expect(amount).toHaveFocus());
  const popup = dialog.closest("[data-money-sheet]") as HTMLElement | null;
  if (!popup) throw new Error("Money sheet popup missing");
  return { trigger, dialog, amount, popup };
}

async function expectSheetAt(popup: HTMLElement, bottom: number) {
  await waitFor(() => expect(Math.abs(popup.getBoundingClientRect().bottom - bottom)).toBeLessThanOrEqual(1));
}

export const SendAmount: Story = {};

export const KeyboardCloseOneTap: Story = {
  beforeEach: installKeyboardViewport,
  play: async ({ canvasElement }) => {
    const screen = storyScreen(canvasElement);
    const { trigger, dialog, amount, popup } = await openAmount(screen);
    await userEvent.type(amount, "12.34");
    setKeyboardHeight(window.innerHeight - 300);
    const keyboardBottom = keyboardViewport.offsetTop + keyboardViewport.height;
    await expectSheetAt(popup, keyboardBottom);
    const continueButton = within(dialog).getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueButton.getBoundingClientRect().bottom).toBeLessThanOrEqual(keyboardBottom + 1));
    const close = within(dialog).getByRole("button", { name: "Close send dialog" });
    const pointerRects: DOMRect[] = [];
    const clickRects: DOMRect[] = [];
    const onPointerDown = (event: PointerEvent) => {
      if (close.contains(event.target as Node)) pointerRects.push(popup.getBoundingClientRect());
    };
    const onClick = (event: MouseEvent) => {
      if (close.contains(event.target as Node)) clickRects.push(popup.getBoundingClientRect());
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    try {
      await userEvent.click(close);
    } finally {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    }
    await expect(pointerRects).toHaveLength(1);
    await expect(clickRects).toHaveLength(1);
    await expect(Math.abs(pointerRects[0].top - clickRects[0].top)).toBeLessThanOrEqual(1);
    await expect(Math.abs(pointerRects[0].bottom - clickRects[0].bottom)).toBeLessThanOrEqual(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Send" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const KeyboardDoneThenReopen: Story = {
  beforeEach: installKeyboardViewport,
  play: async ({ canvasElement }) => {
    const screen = storyScreen(canvasElement);
    const { trigger, dialog, amount, popup } = await openAmount(screen);
    await userEvent.type(amount, "12.34");
    setKeyboardHeight(window.innerHeight - 300);
    await expectSheetAt(popup, keyboardViewport.height);
    amount.blur();
    setKeyboardHeight(window.innerHeight);
    await expectSheetAt(popup, window.innerHeight);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close send dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Send" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    const reopened = await openAmount(screen);
    await expect(reopened.amount).toHaveValue("");
    await expectSheetAt(reopened.popup, window.innerHeight);
  },
};

export const ExactAmountSubmission: Story = {
  beforeEach: installKeyboardViewport,
  play: async ({ canvasElement }) => {
    const screen = storyScreen(canvasElement);
    const { dialog, amount, popup } = await openAmount(screen);
    await userEvent.type(amount, "12.345678");
    await expect(amount).toHaveValue("12.345678");
    setKeyboardHeight(window.innerHeight - 300);
    await expectSheetAt(popup, keyboardViewport.height);
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    const recipient = await screen.findByRole("textbox", { name: "To" });
    await userEvent.type(recipient, RECIPIENT);
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(journey.prepares).toEqual([{ kind: "send", params: { assetId: "usdc", recipient: RECIPIENT, amountBaseUnits: "12345678" } }]));
  },
};
