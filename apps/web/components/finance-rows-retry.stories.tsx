import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { BalanceRow } from "./finance-rows";

function FinanceRowAlignment({ onRetry, onActivate, width = 480 }: { onRetry: () => void; onActivate: () => void; width?: number }) {
  return (
    <ul className="list-none p-0" style={{ width, maxWidth: "100%" }}>
      <BalanceRow icon="$" label="Cash" context="Savings" value="$30.01" onActivate={() => {}} />
      <BalanceRow icon="$" label="Invest" context="Savings" value="$30.01"
        onActivate={onActivate} readRetry={{ label: "Retry balance", onRetry }} />
      <BalanceRow icon="$" label="Borrow" context="Details" value="$30.01" valueContext="USD" onActivate={() => {}} />
      <BalanceRow icon="$" label="Single" value="$30.01" valueContext="USD" onActivate={() => {}} />
      <BalanceRow icon="$" label="Long" context="Details"
        value="$1,234,567,890.12" onActivate={() => {}} />
    </ul>
  );
}

const meta = {
  id: "ui-finance-rows-retry",
  title: "UI/Finance Rows Retry",
  component: FinanceRowAlignment,
  args: { onRetry: fn(), onActivate: fn(), width: 480 },
  parameters: {
    layout: "centered",
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=96-1147" },
  },
} satisfies Meta<typeof FinanceRowAlignment>;

export default meta;
type Story = StoryObj<typeof meta>;

function rect(element: Element | null): DOMRect {
  if (!element) throw new Error("Finance row element missing");
  return element.getBoundingClientRect();
}

async function aligned(a: number, b: number) {
  await expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
}

async function verifyRows(canvasElement: HTMLElement, onRetry: () => void, onActivate: () => void, enlarged = false) {
  const rows = [...canvasElement.querySelectorAll("li")];
  await expect(rows).toHaveLength(5);
  const label = (index: number) => rect(rows[index]!.querySelector("[data-slot=finance-row-body] > [data-slot=item-content]"));
  const value = (index: number) => rect(rows[index]!.querySelector("[data-slot=finance-row-value]"));
  const center = (box: DOMRect) => box.top + box.height / 2;
  const sameLineOrWrapped = async (index: number) => {
    if (enlarged && value(index).top >= label(index).bottom - 1) {
      const body = rect(rows[index]!.querySelector("[data-slot=finance-row-body]"));
      await aligned(value(index).right, body.right);
      const title = rows[index]!.querySelector<HTMLElement>("[data-slot=finance-row-value] [data-slot=item-title]");
      if (title) await expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth + 1);
      return;
    }
    await aligned(center(label(index)), center(value(index)));
  };
  await sameLineOrWrapped(0);
  await sameLineOrWrapped(1);
  if (!enlarged || value(2).top < label(2).bottom - 1) {
    await aligned(rect(rows[2]!.querySelector("[data-slot=item-title]")).top,
      rect(rows[2]!.querySelector("[data-slot=finance-row-value] [data-slot=item-title]")).top);
  }
  await sameLineOrWrapped(3);
  await sameLineOrWrapped(4);
  await aligned(value(0).right, value(1).right);
  const body = rect(rows[4]!.querySelector("[data-slot=finance-row-body]"));
  const stacked = enlarged && value(4).top >= label(4).bottom - 1;
  await expect(value(4).width).toBeLessThanOrEqual(stacked ? body.width + 1 : body.width * 2 / 3 + 1);
  await expect(value(4).right).toBeLessThanOrEqual(body.right + 1);
  await expect(rect(rows[0]!.querySelector("[data-slot=item-media]")).height).toBeGreaterThan(0);
  await expect(rect(rows[0]!.querySelector("[data-slot=item-actions]")).height).toBeGreaterThan(0);
  const retry = within(canvasElement).getByRole("button", { name: "Retry balance" });
  await expect(retry.closest("[data-slot=item]")).toBeNull();
  await expect(rect(retry).height).toBeGreaterThanOrEqual(44);
  await expect(rows[1]!.querySelector("[data-slot=item-actions]")?.querySelectorAll("svg")).toHaveLength(0);
  retry.focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard(" ");
  await expect(onRetry).toHaveBeenCalledTimes(2);
  await expect(onActivate).not.toHaveBeenCalled();
}

export const AlignmentAndRetry: Story = {
  play: async ({ args, canvasElement }) => verifyRows(canvasElement, args.onRetry, args.onActivate),
};

export const NarrowEnlargedText: Story = {
  args: { width: 320 },
  play: async ({ args, canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await verifyRows(canvasElement, args.onRetry, args.onActivate, true);
    } finally {
      root.style.fontSize = previous;
    }
  },
};

export const RtlSlot: Story = {
  render: (args) => (
    <div dir="rtl">
      <FinanceRowAlignment {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const rows = [...canvasElement.querySelectorAll("li")];
    const chevron = rect(rows[0]!.querySelector("[data-slot=item-actions]"));
    const retrySlot = rect(rows[1]!.querySelector("[data-slot=item-actions]"));
    const retryIcon = rect(rows[1]!.querySelector("button[aria-label='Retry balance'] svg"));
    await aligned(chevron.left, retrySlot.left);
    await aligned(retrySlot.left + retrySlot.width / 2, retryIcon.left + retryIcon.width / 2);
    await aligned(rect(rows[0]!.querySelector("[data-slot=finance-row-value]")).left,
      rect(rows[1]!.querySelector("[data-slot=finance-row-value]")).left);
  },
};
