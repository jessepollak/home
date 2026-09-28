import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { INVEST_SETTINGS_DEFAULTS } from "@/shared/operator-settings/invest";
import { InvestPane } from "./invest-pane";

const defaults = { value: INVEST_SETTINGS_DEFAULTS, revision: 0, source: "default" as const, updatedAt: null, updatedBy: null };
const saved = {
  value: { hiddenCategories: ["stock" as const], hiddenAssets: ["cbbtc"] },
  revision: 2,
  source: "stored" as const,
  updatedAt: "2026-09-25T12:00:00.000Z",
  updatedBy: "0x1111111111111111111111111111111111111111",
};

const meta = {
  id: "operator-invest-pane",
  title: "Operator/Invest",
  component: InvestPane,
  args: { initialEntry: defaults },
  parameters: { layout: "padded", a11y: { test: "error" } },
  decorators: [(Story: () => React.ReactNode) => <main className="mx-auto max-w-3xl"><Story /></main>],
} satisfies Meta<typeof InvestPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BuiltInDefaults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Using Home's built-in catalog")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save changes" })).toBeDisabled();
  },
};

export const SavedWithHiddenAssets: Story = {
  args: { initialEntry: saved },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("switch", { name: "Stocks category" })).not.toBeChecked();
    await expect(canvas.queryByRole("switch", { name: "NVIDIA (NVDA)" })).toBeNull();
    await expect(canvas.getByRole("switch", { name: "Bitcoin (BTC)" })).not.toBeChecked();
  },
};

export const Conflict: Story = {
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/invest", () => HttpResponse.json({
      error: { code: "SETTINGS_CONFLICT" },
      current: { version: 1, domain: "invest", settings: saved },
    }, { status: 409 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("switch", { name: "Memes category" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
    await expect(canvas.findByText("Someone else changed these settings. Review the latest values and save again.")).resolves.toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Memes category" })).toBeChecked();
    await expect(canvas.getByRole("switch", { name: "Stocks category" })).not.toBeChecked();
    await expect(canvas.getByRole("button", { name: "Save changes" })).toBeDisabled();
  },
};

export const SaveError: Story = {
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/invest", () => HttpResponse.json({ error: { code: "SETTINGS_UNAVAILABLE" } }, { status: 503 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("switch", { name: "Bitcoin (BTC)" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
    await expect(canvas.findByText("Couldn't save. Try again.")).resolves.toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save changes" })).toBeEnabled();
  },
};
