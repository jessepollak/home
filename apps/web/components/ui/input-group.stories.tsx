import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { XIcon } from "lucide-react";
import { expect, waitFor, within } from "storybook/test";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "./input-group";

const meta = {
  id: "ui-input-group",
  title: "UI/Input Group",
  component: InputGroup,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupAddon>
        <InputGroupText>USDC</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Amount" inputMode="decimal" placeholder="0.00" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton>Max</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const StackedLabel: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupAddon align="block-start">
        <InputGroupText>Recipient address</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Recipient address" placeholder="0x" />
    </InputGroup>
  ),
};

/**
 * `InputGroupButton` keeps its own compact sizes instead of forwarding `size`,
 * so this story proves the wrapper still forwards the matching press tier: an
 * `icon-xs` affordance compresses like an icon control, not like a text action.
 * Real pointer input is required because synthetic events never set `:active`,
 * so the check only runs under the story-test gate; see `button.stories.tsx`.
 */
export const IconButtonPress: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput aria-label="Amount" inputMode="decimal" placeholder="0.00" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Clear amount">
          <XIcon className="size-3.5" aria-hidden="true" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
  play: async ({ canvasElement }) => {
    const vitestBrowser = globalThis as { __vitest_browser__?: boolean };
    if (!vitestBrowser.__vitest_browser__) return;
    const { userEvent } = (await import("vitest/browser")) as unknown as {
      userEvent: { click: (element: Element, options?: { delay?: number }) => Promise<void> };
    };

    const control = within(canvasElement).getByRole("button", { name: "Clear amount" });
    const heldScale = () => getComputedStyle(control).scale;
    let pressed: string | null = null;
    const observation = waitFor(
      async () => {
        await expect(heldScale()).not.toBe("none");
        pressed = heldScale();
      },
      { timeout: 3000, interval: 20 },
    );

    await userEvent.click(control, { delay: 500 });
    await observation;

    await expect(pressed).toBe("0.95");
    await waitFor(() => expect(heldScale()).toBe("none"), { timeout: 2000, interval: 20 });
  },
};
