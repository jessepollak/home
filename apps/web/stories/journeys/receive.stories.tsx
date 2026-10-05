import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { ReceiveBody } from "@/client/funding/add-money-dialog";
import { MoneyModal, MoneyModalHeader, MoneyModalStep } from "@/client/money-modal";
import { Button } from "@/components/ui/button";
import type { RegionId } from "@/config/regions";

const address = "0x1234567890abcdef1234567890abcdef12345678";
const nextAddress = "0xabcdef1234567890abcdef1234567890abcdef12";
let finishCopy: (() => void) | null = null;

function Journey({ regionId = "US", loading = false, changeAccount = false }: { regionId?: RegionId; loading?: boolean; changeAccount?: boolean }) {
  const [currentAddress, setCurrentAddress] = useState<`0x${string}` | null>(loading ? null : address);
  const [open, setOpen] = useState(true);
  return <main><h1 className="sr-only">Receive journey</h1>
    <MoneyModal open={open} labelledBy="receive-story-title" onCancel={() => setOpen(false)} onClose={() => {}}>
      <MoneyModalStep step="receive" depth={1}>
        <MoneyModalHeader title="Receive" titleId="receive-story-title" onBack={() => setOpen(false)} closeLabel="Close add money" />
        <ReceiveBody address={currentAddress} regionId={regionId} />
        {changeAccount ? <Button variant="outline" size="touch" onClick={() => setCurrentAddress(nextAddress)}>Change account</Button> : null}
      </MoneyModalStep>
    </MoneyModal>
  </main>;
}

function browserCapabilities({ clipboard = "success", share = "unsupported" }: { clipboard?: "success" | "missing" | "pending"; share?: "unsupported" | "rejected" } = {}) {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, "share");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard === "missing" ? undefined : {
    writeText: () => clipboard === "pending" ? new Promise<void>((resolve) => { finishCopy = resolve; }) : Promise.resolve(),
  } });
  Object.defineProperty(navigator, "share", { configurable: true, value: share === "unsupported" ? undefined : () => Promise.reject(new DOMException("Sharing unavailable", "NotAllowedError")) });
  return () => {
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
    if (shareDescriptor) Object.defineProperty(navigator, "share", shareDescriptor);
    else Reflect.deleteProperty(navigator, "share");
    finishCopy = null;
  };
}

const meta = {
  id: "receive", title: "Journeys/Receive", component: Journey,
  parameters: { viewport: { defaultViewport: "mobile" }, a11y: { test: "error" } },
  beforeEach: () => browserCapabilities(),
} satisfies Meta<typeof Journey>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("button", { name: "Copy address" })).toBeVisible();
    await expect(screen.getByText(address, { exact: true })).toBeVisible();
    await expect(screen.getByText("Send USDC.", { exact: true })).toBeVisible();
    await expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  },
};
export const EurRegion: Story = {
  args: { regionId: "FR" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("Send USDC or EURC.", { exact: true })).toBeVisible();
  },
};
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("Preparing your Base address")).toBeVisible();
    await expect(screen.queryByRole("img", { name: /QR code/ })).not.toBeInTheDocument();
    await expect(screen.queryByRole("button", { name: "Copy address" })).not.toBeInTheDocument();
    await expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  },
};
export const CopySuccess: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(await screen.findByRole("button", { name: "Copy address" }));
    await expect(await screen.findByRole("status")).toHaveTextContent("Address copied");
    await expect(screen.getByText(address, { exact: true })).toBeVisible();
  },
};
export const ClipboardUnavailable: Story = {
  args: {}, beforeEach: () => browserCapabilities({ clipboard: "missing" }),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(await screen.findByRole("button", { name: "Copy address" }));
    await expect(await screen.findByRole("alert")).toHaveTextContent("Select the address above and copy it");
    await expect(screen.getByText(address, { exact: true })).toHaveFocus();
    await expect(canvasElement.ownerDocument.getSelection()?.toString()).toBe(address);
  },
};
export const ShareRejected: Story = {
  args: {}, beforeEach: () => browserCapabilities({ share: "rejected" }),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(await screen.findByRole("button", { name: "Share" }));
    await expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open sharing. Copy the address instead.");
  },
};
export const AddressChangeClearsState: Story = {
  args: { changeAccount: true }, beforeEach: () => browserCapabilities({ clipboard: "pending", share: "rejected" }),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(await screen.findByRole("button", { name: "Share" }));
    await expect(await screen.findByRole("alert")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await userEvent.click(screen.getByRole("button", { name: "Change account" }));
    finishCopy?.();
    await expect(await screen.findByText(nextAddress, { exact: true })).toBeVisible();
    await expect(screen.queryByText(address, { exact: true })).not.toBeInTheDocument();
    await expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await expect(screen.getByRole("status")).toHaveTextContent("");
  },
};
