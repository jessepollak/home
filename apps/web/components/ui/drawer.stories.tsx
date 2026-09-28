import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AppDrawer, MoneyModalBody, MoneyModalFooter, MoneyModalHeader } from "@/client/money-modal";
import { expect, waitFor, within } from "storybook/test";
import { Button } from "./button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "./drawer";

const meta = {
  id: "ui-drawer",
  title: "UI/Drawer",
  component: Drawer,
  parameters: { layout: "centered", a11y: { test: "error" }, design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=161-1847" } },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger render={<Button variant="outline">Open drawer</Button>} />
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Review deposit</DrawerTitle>
          <DrawerDescription>USDC on Base</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button>Deposit $25.00</Button>
          <DrawerClose render={<Button variant="outline">Back</Button>} />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
};

export const Open: Story = {
  args: { defaultOpen: true, showSwipeHandle: true },
  render: (args) => (
    <Drawer {...args}>
      <DrawerTrigger render={<Button variant="outline">Open drawer</Button>} />
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Review deposit</DrawerTitle>
          <DrawerDescription>USDC on Base</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button>Deposit $25.00</Button>
          <DrawerClose render={<Button variant="outline">Back</Button>} />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
};

export const Dark: Story = {
  ...Open,
  globals: { theme: "dark" },
  play: async ({ canvasElement }) => {
    const popup = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Review deposit" });
    await expect(canvasElement.contains(popup)).toBe(false);
    await expect(popup).toBeVisible();
  },
};

function MoneyDialogPreview() {
  return (
    <AppDrawer open immediate variant="money" labelledBy="preview-money-title" onCancel={() => {}}>
      <MoneyModalHeader title="Send" titleId="preview-money-title" />
      <MoneyModalBody hasFooter className="gap-4 pt-4">
        <label htmlFor="preview-amount">Amount</label>
        <input id="preview-amount" data-money-amount-input inputMode="decimal" />
      </MoneyModalBody>
      <MoneyModalFooter primaryLabel="Continue" />
    </AppDrawer>
  );
}

async function expectMoneyDialogGeometry(canvasElement: HTMLElement, width: number, height: number, desktop: boolean) {
  const view = canvasElement.ownerDocument.defaultView!;
  await expect(view.innerWidth).toBe(width);
  await expect(view.innerHeight).toBe(height);
  const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Send" });
  await waitFor(async () => {
    const rect = dialog.getBoundingClientRect();
    await expect(rect.width).toBeLessThanOrEqual(480);
    await expect(rect.width).toBeGreaterThan(0);
    if (desktop) {
      await expect(Math.abs(rect.left + rect.width / 2 - width / 2)).toBeLessThanOrEqual(2);
      await expect(Math.abs(rect.top + rect.height / 2 - height / 2)).toBeLessThanOrEqual(2);
      await expect(rect.height).toBeLessThanOrEqual(height * 0.88 + 1);
      await expect(canvasElement.ownerDocument.querySelector("[data-money-sheet-grabber]")).not.toBeVisible();
    } else {
      await expect(Math.abs(rect.bottom - height)).toBeLessThanOrEqual(2);
      await expect(canvasElement.ownerDocument.querySelector("[data-money-sheet-grabber]")).toBeVisible();
    }
  });
}

export const MoneyDesktop1440: Story = {
  parameters: { layout: "fullscreen", viewport: { viewports: { money1440: { name: "1440 × 900", styles: { width: "1440px", height: "900px" } } }, defaultViewport: "money1440" } },
  render: () => <MoneyDialogPreview />,
  play: async ({ canvasElement }) => expectMoneyDialogGeometry(canvasElement, 1440, 900, true),
};

export const MoneyDesktop1024: Story = {
  parameters: { layout: "fullscreen", viewport: { viewports: { money1024: { name: "1024 × 768", styles: { width: "1024px", height: "768px" } } }, defaultViewport: "money1024" } },
  render: () => <MoneyDialogPreview />,
  play: async ({ canvasElement }) => expectMoneyDialogGeometry(canvasElement, 1024, 768, true),
};

export const MoneyMobile390: Story = {
  parameters: { layout: "fullscreen", viewport: { viewports: { money390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "money390" } },
  render: () => <MoneyDialogPreview />,
  play: async ({ canvasElement }) => expectMoneyDialogGeometry(canvasElement, 390, 844, false),
};
