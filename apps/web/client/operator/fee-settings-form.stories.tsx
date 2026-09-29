import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { FeeSettingsForm, type FeeSettingsState } from "./fee-settings-form";

const destination = "0x52908400098527886e0f7030069857d2e4169ee7";
const nextDestination = "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359";
const operator = "0x2222222222222222222222222222222222222222" as const;

const defaults: FeeSettingsState = { value: { trade: { bps: 0, recipient: null } }, revision: 0, source: "default", updatedAt: null, updatedBy: null };
const stored: FeeSettingsState = {
  value: { trade: { bps: 50, recipient: destination } },
  revision: 3,
  source: "stored",
  updatedAt: "2026-09-24T12:00:00.000Z",
  updatedBy: "0x2222222222222222222222222222222222222222",
};

function saved(settings: FeeSettingsState) {
  return { version: 1, domain: "fees", settings };
}

function FeeSettingsStory({ initial, operator }: { initial: FeeSettingsState; operator: `0x${string}` }) {
  return (
    <div className="min-h-screen bg-muted p-4 sm:p-8">
      <div className="mx-auto grid w-full max-w-5xl gap-8">
        <FeeSettingsForm initial={initial} operator={operator} />
      </div>
    </div>
  );
}

const meta = {
  id: "operator-fee-settings",
  title: "Operator/Fee Settings",
  component: FeeSettingsStory,
  args: { initial: stored, operator },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof FeeSettingsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { initial: defaults, operator },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Not saved yet.")).toBeVisible();
    await userEvent.clear(canvas.getByLabelText("Swap fee"));
    await userEvent.type(canvas.getByLabelText("Swap fee"), "40");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("Add a revenue destination to charge a fee.")).toBeVisible();
    await expect(canvas.getByLabelText("Revenue destination")).toHaveFocus();
  },
};

export const StoredWithDestination: Story = {
  args: { operator },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Revenue destination")).toHaveValue("0x52908400098527886E0F7030069857D2E4169EE7");
    await expect(canvas.getByText("50 bps = 0.50% of each swap.")).toBeVisible();
    await expect(canvas.getByText(/Last updated Sep 24, 2026/)).toBeVisible();
  },
};

export const DestinationChangeConfirmation: Story = {
  args: { operator },
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/fees", () => HttpResponse.json(saved({ ...stored, revision: 4, value: { trade: { bps: 50, recipient: nextDestination } } })))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText("Revenue destination");
    await userEvent.clear(field);
    await userEvent.type(field, nextDestination);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    const heading = await canvas.findByRole("heading", { name: "Confirm revenue destination" });
    await expect(heading).toHaveFocus();
    await expect(canvas.getByText("0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359")).toBeVisible();
  },
};

export const Conflict: Story = {
  args: { operator },
  parameters: {
    msw: {
      handlers: [http.put("/api/admin/settings/fees", () => HttpResponse.json({
        error: { code: "SETTINGS_CONFLICT" },
        current: saved({ ...stored, revision: 5, value: { trade: { bps: 120, recipient: destination } }, updatedAt: "2026-09-24T12:30:00.000Z" }),
      }, { status: 409 }))],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bps = canvas.getByLabelText("Swap fee");
    await userEvent.clear(bps);
    await userEvent.type(bps, "80");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("Settings changed")).toBeVisible();
    await waitFor(() => expect(bps).toHaveValue("120"));
  },
};

export const SaveError: Story = {
  args: { operator },
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/fees", () => HttpResponse.json({ error: { code: "SETTINGS_UNAVAILABLE" } }, { status: 503 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bps = canvas.getByLabelText("Swap fee");
    await userEvent.clear(bps);
    await userEvent.type(bps, "60");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("Settings are unavailable right now. Try again in a moment.");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Save" })).toHaveFocus());
  },
};
