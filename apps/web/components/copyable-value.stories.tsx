import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CopyableValue } from "./copyable-value";

const ADDRESS = "0x2211d1d0020daea8039e46cf1367962070d77da9";
const SHORT_ADDRESS = "0x2211…d77da9";

function AddressStory({ width, presentation = "reveal" }: { width: number; presentation?: "reveal" | "full" | "compact" }) {
  return (
    <div className="w-full px-6" style={{ maxWidth: width }}>
      <dl>
        <div className="grid min-w-0 gap-1 border-b py-3 text-sm">
          <dt>To</dt>
          <dd className="min-w-0">
            <CopyableValue value={ADDRESS} display={presentation === "compact" ? SHORT_ADDRESS : undefined} presentation={presentation} valueKind="address" />
          </dd>
        </div>
      </dl>
    </div>
  );
}

async function expectReveal(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const trigger = canvas.getByRole("button", { name: `Show full address ${SHORT_ADDRESS}` });
  const text = canvas.getByText(SHORT_ADDRESS, { exact: true });
  const range = document.createRange();
  range.selectNodeContents(text);

  await expect(range.getClientRects().length).toBe(1);
  await expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await userEvent.click(trigger);

  const popover = await within(document.body).findByRole("dialog", { name: "Full address" });
  const fullValue = within(popover).getByLabelText(`Full address ${ADDRESS}`);
  const bounds = popover.getBoundingClientRect();
  await expect(fullValue.textContent).toBe(ADDRESS);
  await expect(bounds.left).toBeGreaterThanOrEqual(0);
  await expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
  await expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth + 1);
  await waitFor(() => expect(within(popover).getByRole("button", { name: "Copy address" })).toBeVisible());
}

const meta = {
  id: "ui-copyable-value",
  title: "UI/Copyable Value",
  component: AddressStory,
  args: { width: 390, presentation: "reveal" },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof AddressStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reveal390: Story = {
  play: async ({ canvasElement }) => { await expectReveal(canvasElement); },
};

export const Reveal320: Story = {
  args: { width: 320 },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => { await expectReveal(canvasElement); },
};

export const EnlargedText: Story = {
  beforeEach: () => {
    const previousFontSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => { document.documentElement.style.fontSize = previousFontSize; };
  },
  play: async ({ canvasElement }) => { await expectReveal(canvasElement); },
};

export const Full: Story = {
  args: { presentation: "full" },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: `Copy ${ADDRESS}` });
    await expect(button.title).toBe(ADDRESS);
  },
};

export const Compact: Story = {
  args: { width: 320, presentation: "compact" },
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: `Copy ${SHORT_ADDRESS}` });
    await expect(button.textContent).toBe(SHORT_ADDRESS);
    await expect(button.title).toBe(ADDRESS);
  },
};
