import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { VERIFIED_SAVE_VAULTS } from "@/shared/savings/config";
import { deploymentProductSettings, productCatalog, type ProductSettings } from "@/shared/operator-settings/products";
import { ProductSettingsEditor } from "./product-settings-editor";

const catalog = productCatalog();
const defaults = deploymentProductSettings(catalog);
const names = {
  vaults: Object.fromEntries(VERIFIED_SAVE_VAULTS.map(({ id, name }) => [id, name])),
  markets: Object.fromEntries(BORROW_MARKETS.map(({ marketId, collateralToken }) => [marketId.toLowerCase(), `${collateralToken.symbol} collateral`])),
};
const address = "0x1111111111111111111111111111111111111111";
function entry(value: ProductSettings, saved: boolean) {
  return { version: 2 as const, domain: "products", settings: { value, revision: saved ? 1 : 0, source: saved ? "stored" as const : "default" as const, updatedAt: saved ? "2026-09-27T12:00:00.000Z" : null, updatedBy: saved ? address : null } };
}
const paused: ProductSettings = { ...defaults, products: { ...defaults.products, save: "exit-only", borrow: "exit-only" } };

const meta = {
  id: "operator-products-settings",
  title: "Operator/Products and markets",
  component: ProductSettingsEditor,
  args: { initialEntry: entry(defaults, false), catalog, names, missingInvestCredentials: [], operator: address },
  parameters: { layout: "padded", a11y: { test: "error" } },
} satisfies Meta<typeof ProductSettingsEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DeploymentValues: Story = {};
export const Saved: Story = { args: { initialEntry: entry(defaults, true), missingInvestCredentials: ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET"] } };
export const ExitOnly: Story = { args: { initialEntry: entry(paused, true) } };
export const OrphanNotice: Story = { args: { initialEntry: entry({ ...defaults, vaults: { ...defaults.vaults, "retired-vault": "enabled" } }, true) } };
export const Conflict: Story = {
  args: { initialEntry: entry(defaults, true) },
  parameters: { msw: { handlers: [http.put("/api/admin/settings/products", () => HttpResponse.json({ error: { code: "SETTINGS_CONFLICT" }, current: entry(paused, true) }, { status: 409 }))] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: "Send mode" })).getByRole("radio", { name: "Off" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save settings" }));
    await expect(await canvas.findByText("Settings changed since you opened this page.")).toBeVisible();
  },
};
export const ReviewStep: Story = {
  args: { initialEntry: entry(paused, true) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: "Save mode" })).getByRole("radio", { name: "On" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save settings" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Review changes" });
    await expect(dialog).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeVisible();
  },
};
export const MixedReview: Story = {
  args: { initialEntry: entry({ ...defaults, products: { ...defaults.products, save: "exit-only" } }, true) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: "Save mode" })).getByRole("radio", { name: "On" }));
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: "Borrow mode" })).getByRole("radio", { name: "Exit only" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save settings" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Review changes" });
    await expect(within(dialog).getByText("Save", { exact: true })).toBeVisible();
    await expect(within(dialog).getByText("Borrow", { exact: true })).toBeVisible();
    await expect(within(dialog).getAllByText("Reducing only", { exact: false }).length).toBeGreaterThan(0);
  },
};
export const PausedEntryChange: Story = {
  args: { initialEntry: entry({ ...defaults, products: { ...defaults.products, save: "exit-only", send: "off" } }, true) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const vault = VERIFIED_SAVE_VAULTS.find((entry) => entry.capabilities.save === "enabled");
    if (!vault) throw new Error("Story needs an enabled vault.");
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: "Save mode" })).getByRole("radio", { name: "On" }));
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: `${vault.name} mode` })).getByRole("radio", { name: "Reducing only" }));
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: "Save mode" })).getByRole("radio", { name: "Exit only" }));
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: "Send mode" })).getByRole("radio", { name: "On" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save settings" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Review changes" });
    await expect(within(dialog).getByText(/Send/)).toBeVisible();
    await expect(within(dialog).getByText("Applies when Save is on.", { exact: false })).toBeVisible();
  },
};
