import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { ArrowDown, HandCoins, PiggyBank } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";
import { CurrencyMark, CurrencyMarkStack, GlyphMark } from "./currency-mark";
import { ActivityRow, BalanceRow } from "./finance-rows";

function textEdge(element: HTMLElement, edge: "left" | "right") {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  return edge === "left" ? rect.left : rect.right;
}

async function expectAligned(left: HTMLElement, right: HTMLElement, edge: "left" | "right") {
  const drift = Math.abs(left.getBoundingClientRect()[edge] - right.getBoundingClientRect()[edge]);
  await expect(drift).toBeLessThanOrEqual(1);
  await expect(Math.abs(textEdge(left, edge) - textEdge(right, edge))).toBeLessThanOrEqual(1);
}

function FinanceRowStory({ row }: { row: "activity" | "attention" | "working" | "balance" | "borrow" | "nux" }) {
  return (
    <ul className="w-[30rem] max-w-full list-none p-0">
      {row === "working" ? (
        <ActivityRow icon={<ArrowDown className="size-4" />} iconTone="mark" label="Deposit" context="Arriving in ~2 min" value="$50.00" working="In progress" onActivate={() => {}} activateLabel="View deposit details" />
      ) : row === "borrow" ? (
        <BalanceRow
          icon={<GlyphMark size="sm"><HandCoins /></GlyphMark>}
          iconTone="mark"
          label="Borrow Cash"
          context="Against your investments"
          value="$30.01"
          valueContext="5.10% APR"
          onActivate={() => {}}
          activateLabel="Open Borrow"
        />
      ) : row === "nux" ? (
        <BalanceRow
          icon={<GlyphMark size="sm"><HandCoins /></GlyphMark>}
          iconTone="mark"
          label="Borrow Cash"
          context="Borrow at 5.10% APR"
          onActivate={() => {}}
          activateLabel="Open Borrow"
        />
      ) : row === "attention" ? (
        <ActivityRow
          icon={<ArrowDown className="size-4" />}
          iconTone="mark"
          label="Add money"
          context={<time dateTime="2026-09-20T20:48:00.000Z">Sep 20, 8:48 PM</time>}
          value="$50.00"
          attention="Action needed"
          onActivate={() => {}}
          activateLabel="View Add money details"
        />
      ) : row === "activity" ? (
        <ActivityRow
          icon={<ArrowDown className="size-4" />}
          iconTone="incoming"
          label="Received"
          context={<time dateTime="2026-09-20T20:48:00.000Z">Sep 20, 8:48 PM</time>}
          value="+425 USDC"
          valueTone="success"
          onActivate={() => {}}
          activateLabel="View Received transaction details"
        />
      ) : (
        <BalanceRow
          icon={<PiggyBank className="size-4" />}
          iconTone="mark"
          label="Bitcoin"
          context="0.001 cbBTC"
          value="$60.00"
          valueContext="USD"
        />
      )}
    </ul>
  );
}

const meta = {
  id: "ui-finance-rows",
  title: "UI/Finance Rows",
  component: FinanceRowStory,
  args: { row: "activity" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof FinanceRowStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Activity: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectAligned(
      canvas.getByText("Received", { exact: true }),
      canvas.getByText("Sep 20, 8:48 PM", { exact: true }),
      "left",
    );
    await expect(canvas.getByText("+425 USDC").getAttribute("data-value-tone")).toBe("success");
  },
};

export const Disclosure: Story = {
  parameters: { library: { render: "frame" } },
  render: () => <DisclosureRows />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const summary = canvas.getByRole("button", { name: /Received/ });
    await expect(summary).toHaveTextContent("Received ×2");
    await expect(summary).toHaveAccessibleDescription("2 Received USDC transfers");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByText("First transfer")).toBeNull();
    await userEvent.click(summary);
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText("First transfer")).toBeVisible();
  },
};

function DisclosureRows() {
  const [expanded, setExpanded] = useState(false);
  return <ul className="w-[30rem] max-w-full list-none p-0">
    <ActivityRow icon={<CurrencyMarkStack symbol="USDC" />} iconTone="stack"
      label="Received" labelSuffix={<span aria-hidden="true">×2</span>} context="Sep 21 – 24"
      value="+$25.00" valueContext="+25.00 USDC" onActivate={() => setExpanded((value) => !value)} activateLabel="2 Received USDC transfers"
      disclosure={{ expanded, controls: "finance-disclosure-example", content: <ul id="finance-disclosure-example"><li>First transfer</li><li>Second transfer</li></ul> }} />
  </ul>;
}

export const Attention: Story = {
  args: { row: "attention" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: /Add money.*Action needed/ })).toBeVisible();
  },
};

export const Balance: Story = {
  args: { row: "balance" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectAligned(
      canvas.getByText("Bitcoin", { exact: true }),
      canvas.getByText("0.001 cbBTC", { exact: true }),
      "left",
    );
    await expectAligned(
      canvas.getByText("$60.00", { exact: true }),
      canvas.getByText("USD", { exact: true }),
      "right",
    );
  },
};

export const TitleAlignedValue: Story = {
  args: { row: "borrow" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const label = canvas.getByText("Borrow Cash", { exact: true });
    const value = canvas.getByText("$30.01", { exact: true });
    const valueContext = canvas.getByText("5.10% APR", { exact: true });
    await expect(Math.abs(label.getBoundingClientRect().top - value.getBoundingClientRect().top))
      .toBeLessThanOrEqual(1);
    await expect(valueContext.getBoundingClientRect().top).toBeGreaterThanOrEqual(value.getBoundingClientRect().bottom - 1);
    await expectAligned(value, valueContext, "right");
  },
};

export const NuxWithoutValue: Story = {
  args: { row: "nux" },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-slot=finance-row-value]")).toBeNull();
    await expect(canvasElement.querySelector("[data-slot=item-actions]")).not.toBeNull();
  },
};

function LongValueRows() {
  return (
    <div className="flex flex-col gap-4">
      {[390, 320].map((width) => (
        <ul key={width} className="max-w-full list-none p-0" style={{ width }} data-row-width={width}>
          <BalanceRow
            icon={<PiggyBank className="size-4" />}
            label="Staked ETH"
            context="Healthy"
            value="12,345,678.90 USDC"
            valueContext="5.01% APR"
            onActivate={() => {}}
            activateLabel="View Staked ETH"
          />
        </ul>
      ))}
    </div>
  );
}

async function expectLongValuesVisible(canvasElement: HTMLElement, wrapped: boolean) {
  for (const width of [390, 320]) {
    const list = canvasElement.querySelector<HTMLElement>(`[data-row-width="${width}"]`);
    if (!list) throw new Error(`Missing ${width}px finance row`);
    const canvas = within(list);
    const row = list.querySelector<HTMLElement>("[data-slot=item]");
    const body = list.querySelector<HTMLElement>("[data-slot=finance-row-body]");
    const column = list.querySelector<HTMLElement>("[data-slot=finance-row-value]");
    if (!row || !body || !column) throw new Error("Missing finance row layout");
    const label = canvas.getByText("Staked ETH");
    const value = canvas.getByText("12,345,678.90 USDC");
    const labelBox = label.getBoundingClientRect();
    const valueBox = value.getBoundingClientRect();
    const columnBox = column.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(value);
    const textBox = range.getBoundingClientRect();
    const inlineEnd = list.closest("[dir=rtl]") ? "left" : "right";
    await expect(list.getBoundingClientRect().width).toBe(width);
    await expect(labelBox.width).toBeGreaterThanOrEqual(40);
    await expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
    await expect(textBox.left).toBeGreaterThanOrEqual(valueBox.left - 1);
    await expect(textBox.right).toBeLessThanOrEqual(valueBox.right + 1);
    await expect(textBox.bottom).toBeLessThanOrEqual(valueBox.bottom + 1);
    await expect(valueBox.left).toBeGreaterThanOrEqual(rowBox.left - 1);
    await expect(valueBox.right).toBeLessThanOrEqual(rowBox.right + 1);
    await expect(Math.abs(columnBox[inlineEnd] - bodyBox[inlineEnd])).toBeLessThanOrEqual(1);
    if (wrapped) {
      await expect(columnBox.top).toBeGreaterThanOrEqual(labelBox.bottom - 1);
    } else if (width === 390) {
      await expect(Math.abs(labelBox.top - valueBox.top)).toBeLessThanOrEqual(1);
    }
    await expect(canvas.getByText("5.01% APR")).toBeVisible();
    await expect(row.querySelector("[data-slot=item-actions]")).not.toBeNull();
  }
}

export const LongValueAtNormalText: Story = {
  render: () => <LongValueRows />,
  play: async ({ canvasElement }) => expectLongValuesVisible(canvasElement, false),
};

export const LongValueAtEnlargedText: Story = {
  render: () => <LongValueRows />,
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectLongValuesVisible(canvasElement, true);
    } finally {
      root.style.fontSize = previous;
    }
  },
};

function StatusValueRows() {
  return (
    <div className="flex flex-col gap-4">
      {[480, 390, 320, 280].map((width) => (
        <ul key={width} className="max-w-full list-none p-0" style={{ width }} data-row-width={width}>
          <BalanceRow
            icon={<CurrencyMark size="sm" currency="CA" symbol="CAD" />}
            iconTone="mark"
            label="Canadian dollar"
            context="CAD"
            value="Additional verification"
            valueTone="muted"
            valueKind="status"
          />
          <BalanceRow
            icon={<CurrencyMark size="sm" currency="CF" symbol="XAF" />}
            iconTone="mark"
            label="Central African CFA franc"
            context="XAF"
            value="Unavailable"
            valueTone="muted"
            valueKind="status"
          />
          <BalanceRow
            icon={<CurrencyMark size="sm" currency="CA" symbol="CAD" />}
            iconTone="mark"
            label="Canadian dollar"
            context="CAD"
            value="12,345,678.90 USDC"
          />
          <BalanceRow
            icon={<CurrencyMark size="sm" currency="CH" symbol="CHF" />}
            iconTone="mark"
            label="Swiss franc"
            context="CHF"
            value="Unavailable"
            valueTone="muted"
            valueKind="status"
            valueContext="$12.34"
          />
        </ul>
      ))}
    </div>
  );
}

async function expectStatusValuesVisible(canvasElement: HTMLElement, enlarged: boolean) {
  for (const width of [480, 390, 320, 280]) {
    const list = canvasElement.querySelector<HTMLElement>(`[data-row-width="${width}"]`);
    if (!list) throw new Error(`Missing ${width}px status rows`);
    await expect(list.getBoundingClientRect().width).toBe(width);
    const rows = within(list).getAllByRole("listitem");
    for (const [index, row] of rows.slice(0, 2).entries()) {
      const canvas = within(row);
      const label = canvas.getByText(index === 0 ? "Canadian dollar" : "Central African CFA franc", { exact: true });
      const value = canvas.getByText(index === 0 ? "Additional verification" : "Unavailable", { exact: true });
      const body = row.querySelector<HTMLElement>("[data-slot=finance-row-body]");
      const column = row.querySelector<HTMLElement>("[data-slot=finance-row-value]");
      if (!body || !column) throw new Error("Missing status layout");
      const rowBox = row.getBoundingClientRect();
      const columnBox = column.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      const inlineEnd = list.closest("[dir=rtl]") ? "left" : "right";
      const range = document.createRange();
      range.selectNodeContents(value);
      const textBoxes = Array.from(range.getClientRects());
      const lineCount = new Set(textBoxes.map((box) => box.top)).size;
      await expect(label.getAttribute("data-slot")).toBe("item-title");
      if (index === 0) {
        await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
        await expect(label.scrollHeight).toBeLessThanOrEqual(label.clientHeight + 1);
        if (!enlarged) {
          const labelRange = document.createRange();
          labelRange.selectNodeContents(label);
          await expect(new Set(Array.from(labelRange.getClientRects()).map((box) => box.top)).size).toBe(1);
        }
      } else {
        await expect(label.getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
      }
      await expect(value.scrollHeight).toBeLessThanOrEqual(value.clientHeight + 1);
      await expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
      await expect(lineCount).toBeGreaterThanOrEqual(1);
      if (!enlarged) {
        await expect(lineCount).toBeLessThanOrEqual(2);
      }
      for (const box of textBoxes) {
        const valueBox = value.getBoundingClientRect();
        await expect(box.left).toBeGreaterThanOrEqual(valueBox.left - 1);
        await expect(box.right).toBeLessThanOrEqual(valueBox.right + 1);
        await expect(box.bottom).toBeLessThanOrEqual(valueBox.bottom + 1);
      }
      const text = value.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error("Missing status text node");
      const wordsFit = !enlarged || width >= 320;
      for (const word of wordsFit ? (value.textContent ?? "").matchAll(/\S+/g) : []) {
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        await expect(range.getClientRects().length).toBe(1);
      }
      await expect(Math.abs(columnBox[inlineEnd] - bodyBox[inlineEnd])).toBeLessThanOrEqual(1);
      await expect(columnBox.left).toBeGreaterThanOrEqual(rowBox.left - 1);
      await expect(columnBox.right).toBeLessThanOrEqual(rowBox.right + 1);
      if (enlarged && width !== 480) {
        await expect(columnBox.top).toBeGreaterThanOrEqual(label.getBoundingClientRect().bottom - 1);
      } else if (enlarged) {
        await expect(columnBox.top).toBeLessThan(label.getBoundingClientRect().bottom);
      }
      await expect(value).toBeVisible();
    }
    const amountRow = rows[2];
    if (!amountRow) throw new Error("Missing amount row");
    const amount = within(amountRow).getByText("12,345,678.90 USDC");
    await expect(amount.scrollWidth).toBeLessThanOrEqual(amount.clientWidth + 1);
    await expect(amount.scrollHeight).toBeLessThanOrEqual(amount.clientHeight + 1);
    const statusContextRow = rows[3];
    if (!statusContextRow) throw new Error("Missing status context row");
    const status = within(statusContextRow).getByText("Unavailable", { exact: true });
    const valueContext = within(statusContextRow).getByText("$12.34", { exact: true });
    for (const text of [status, valueContext]) {
      await expect(text.scrollHeight).toBeLessThanOrEqual(text.clientHeight + 1);
      await expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1);
      const range = document.createRange();
      range.selectNodeContents(text);
      const textBox = text.getBoundingClientRect();
      const rects = Array.from(range.getClientRects());
      await expect(rects.length).toBeGreaterThan(0);
      for (const box of rects) {
        await expect(box.left).toBeGreaterThanOrEqual(textBox.left - 1);
        await expect(box.right).toBeLessThanOrEqual(textBox.right + 1);
        await expect(box.bottom).toBeLessThanOrEqual(textBox.bottom + 1);
      }
      await expect(text).toBeVisible();
    }
    await expect(valueContext.getBoundingClientRect().top).toBeGreaterThanOrEqual(status.getBoundingClientRect().bottom);
    const statusContextColumn = statusContextRow.querySelector<HTMLElement>("[data-slot=finance-row-value]");
    if (!statusContextColumn) throw new Error("Missing status context layout");
    const statusContextRowBox = statusContextRow.getBoundingClientRect();
    const statusContextColumnBox = statusContextColumn.getBoundingClientRect();
    await expect(statusContextColumnBox.left).toBeGreaterThanOrEqual(statusContextRowBox.left - 1);
    await expect(statusContextColumnBox.right).toBeLessThanOrEqual(statusContextRowBox.right + 1);
    await expect(statusContextColumnBox.top).toBeGreaterThanOrEqual(statusContextRowBox.top - 1);
    await expect(statusContextColumnBox.bottom).toBeLessThanOrEqual(statusContextRowBox.bottom + 1);
  }
}

export const StatusValueAtNormalText: Story = {
  render: () => <StatusValueRows />,
  play: async ({ canvasElement }) => expectStatusValuesVisible(canvasElement, false),
};

export const StatusValueAtEnlargedText: Story = {
  render: () => <StatusValueRows />,
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectStatusValuesVisible(canvasElement, true);
    } finally {
      root.style.fontSize = previous;
    }
  },
};

export const RtlStatusValueAtNormalText: Story = {
  render: () => <div dir="rtl"><StatusValueRows /></div>,
  play: async ({ canvasElement }) => expectStatusValuesVisible(canvasElement, false),
};

export const RtlStatusValueAtEnlargedText: Story = {
  render: () => <div dir="rtl"><StatusValueRows /></div>,
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectStatusValuesVisible(canvasElement, true);
    } finally {
      root.style.fontSize = previous;
    }
  },
};

export const RtlLongValueAtEnlargedText: Story = {
  render: () => <div dir="rtl"><LongValueRows /></div>,
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectLongValuesVisible(canvasElement, true);
    } finally {
      root.style.fontSize = previous;
    }
  },
};

export const NeedsYou: Story = { ...Attention };
export const NeedsYouDark: Story = { ...NeedsYou, globals: { theme: "dark" } };
export const Working: Story = {
  args: { row: "working" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: /Deposit.*In progress/ })).toBeVisible();
    await expect(canvas.getByText("Arriving in ~2 min")).toBeVisible();
    const slot = canvasElement.querySelector('[data-slot="item-actions"]');
    if (!slot) throw new Error("Missing trailing slot");
    await expect(slot.getBoundingClientRect().width).toBe(16);
    const spinner = slot.querySelector('[data-slot="status-spinner"]');
    if (!spinner) throw new Error("Missing working spinner");
    await expect(spinner).toBeVisible();
    await expect(spinner.clientWidth).toBe(16);
  },
};
export const WorkingDark: Story = { ...Working, globals: { theme: "dark" } };
export const WorkingWithoutActivation: Story = {
  render: () => <ul className="w-[30rem] max-w-full list-none p-0"><ActivityRow icon={<ArrowDown className="size-4" />} label="Deposit" context="Arriving in ~2 min" value="$50.00" working="In progress" /></ul>,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("button")).toBeNull();
    await expect(within(canvasElement).getByText("In progress")).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-slot="status-spinner"]')).toBeVisible();
  },
};
