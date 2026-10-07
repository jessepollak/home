import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { REGION_SETTINGS_DEFAULTS } from "@/shared/operator-settings/regions";
import { RegionsPane } from "./regions-pane";

const defaults = { value: REGION_SETTINGS_DEFAULTS, revision: 0, source: "default" as const, updatedAt: null, updatedBy: null };
const operator = "0x1111111111111111111111111111111111111111" as const;
const saved = {
  value: { offered: REGION_SETTINGS_DEFAULTS.offered.filter((id) => id !== "US"), defaultRegion: "GLOBAL" as const },
  revision: 2,
  source: "stored" as const,
  updatedAt: "2026-09-25T12:00:00.000Z",
  updatedBy: "0x1111111111111111111111111111111111111111",
};

const meta = {
  id: "operator-regions-pane",
  title: "Operator/Regions",
  component: RegionsPane,
  args: { initialEntry: defaults, operator },
  parameters: { layout: "padded", a11y: { test: "error" } },
  decorators: [(Story: () => React.ReactNode) => <main className="mx-auto max-w-3xl"><Story /></main>],
} satisfies Meta<typeof RegionsPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BuiltInDefaults: Story = {};
export const SavedWithCountriesOff: Story = { args: { initialEntry: saved } };
export const ReviewChanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("switch", { name: "United States" }));
    await userEvent.click(canvas.getByRole("button", { name: "Review changes" }));
    await expect(within(document.body).getByRole("dialog", { name: "Review region changes" })).toBeVisible();
  },
};
export const Conflict: Story = {
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/regions", () => HttpResponse.json({
      error: { code: "SETTINGS_CONFLICT" },
      current: { version: 2, domain: "regions", settings: saved },
    }, { status: 409 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("switch", { name: "United States" }));
    await userEvent.click(canvas.getByRole("button", { name: "Review changes" }));
    await userEvent.click(within(document.body).getByRole("button", { name: "Confirm changes" }));
    await expect(canvas.findByText(/Someone else changed these settings/)).resolves.toBeVisible();
  },
};
