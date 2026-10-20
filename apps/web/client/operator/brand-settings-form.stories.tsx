import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { BRAND_DEFAULTS } from "@/shared/operator-branding/contract";
import { BrandSettingsForm, type BrandSettingsState } from "./brand-settings-form";

const operator = "0x2222222222222222222222222222222222222222" as const;

const defaults: BrandSettingsState = { value: BRAND_DEFAULTS, revision: 0, source: "default", updatedAt: null, updatedBy: null };
const stored: BrandSettingsState = {
  value: { displayName: "Acme Money", description: "Money for Acme customers.", primaryColor: "#0b6b3a", backgroundColor: "#f5f8f2" },
  revision: 3,
  source: "stored",
  updatedAt: "2026-09-24T12:00:00.000Z",
  updatedBy: "0x2222222222222222222222222222222222222222",
};

function response(settings: BrandSettingsState) {
  return { version: 2, domain: "brand", settings };
}

function BrandSettingsStory({ initial, operator }: { initial: BrandSettingsState; operator: `0x${string}` }) {
  return (
    <div className="min-h-screen bg-muted p-4 sm:p-8">
      <div className="mx-auto grid w-full max-w-5xl gap-8">
        <BrandSettingsForm initial={initial} operator={operator} />
      </div>
    </div>
  );
}

const meta = {
  id: "operator-brand-settings",
  title: "Operator/Brand Settings",
  component: BrandSettingsStory,
  args: { initial: stored, operator },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrandSettingsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DeploymentDefaults: Story = {
  args: { initial: defaults },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForReady(() => expect(canvas.getByText("Using deployment defaults. Nothing is saved yet.")).toBeVisible());
    await userEvent.clear(canvas.getByLabelText("Display name"));
    await userEvent.type(canvas.getByLabelText("Primary color"), "x");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("Enter a display name.")).toBeVisible();
    await expect(canvas.getByLabelText("Display name")).toHaveFocus();
  },
};

export const Saved: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForReady(() => expect(canvas.getByText(/Saved settings, revision 3\./)).toBeVisible());
    await expect(canvas.getByLabelText("Display name")).toHaveValue("Acme Money");
    await expect(canvas.getByRole("group", { name: "Customer preview" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeDisabled();
  },
};

export const LightenedBackground: Story = {
  args: { initial: { ...stored, value: { ...stored.value, backgroundColor: "#1f2a44", primaryColor: "#ffd60a" } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForReady(() => expect(canvas.getByText(/Light pages only\./)).toBeVisible());
    await expect(canvas.getByText(/Darkened to #[0-9a-f]{6} on light pages/)).toBeVisible();
  },
};

export const SaveSucceeds: Story = {
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/brand", () => HttpResponse.json(response({ ...stored, revision: 4, value: { ...stored.value, displayName: "Acme Bank" } })))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByLabelText("Display name");
    await userEvent.clear(name);
    await userEvent.type(name, "Acme Bank");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("Saved. Customers see this the next time they open a page.")).toBeVisible();
    await expect(canvas.getByText(/revision 4\./)).toBeVisible();
  },
};

export const SaveError: Story = {
  parameters: { msw: { handlers: [http.put("/api/admin/settings/brand", () => HttpResponse.json({ error: { code: "SETTINGS_UNAVAILABLE" } }, { status: 503 }))] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByLabelText("Display name");
    await userEvent.clear(name);
    await userEvent.type(name, "Draft Name");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Your changes are kept");
    await expect(name).toHaveValue("Draft Name");
    await expect(canvas.getByRole("button", { name: "Save" })).toBeEnabled();
  },
};

export const Conflict: Story = {
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/brand", () => HttpResponse.json({
      error: { code: "SETTINGS_CONFLICT" },
      current: response({ ...stored, revision: 4, value: { ...stored.value, description: "Won the race." } }),
    }, { status: 409 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByLabelText("Display name");
    await userEvent.clear(name);
    await userEvent.type(name, "Draft Name");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText(/Someone else saved brand settings \(revision 4/)).toBeVisible();
    await expect(name).toHaveValue("Draft Name");
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Keep my edits" }));
    await expect(name).toHaveValue("Draft Name");
    await expect(canvas.getByLabelText("Description")).toHaveValue("Won the race.");
    await expect(canvas.getByRole("button", { name: "Save" })).toBeEnabled();
  },
};

export const OperatorChanged: Story = {
  parameters: {
    msw: { handlers: [http.put("/api/admin/settings/brand", () => HttpResponse.json({ error: { code: "OPERATOR_CHANGED" }, current: response(stored) }, { status: 409 }))] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByLabelText("Display name");
    await userEvent.type(name, "!");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("A different operator is signed in. Reload this page before saving.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Reload page" })).toBeVisible();
  },
};
