import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
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
