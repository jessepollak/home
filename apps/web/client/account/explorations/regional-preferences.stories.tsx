import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { RegionalPreferencesProposal } from "./regional-preferences";
import { RegionalShell } from "@/client/home/explorations/regional-shell";

const meta = {
  id: "explorations-regional-preferences",
  title: "Explorations/Regional preferences",
  component: RegionalPreferencesProposal,
  args: { initialCountry: "BR" },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
    a11y: { test: "error" },
    docs: { description: { component: "Unreviewed #638 proposal. Countries, language, and account status are illustrative fixed fixtures; no preference is saved." } },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=311-12034" },
  },
} satisfies Meta<typeof RegionalPreferencesProposal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstUseAlignedDefaults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Display currency" })).toHaveTextContent("Brazilian real");
    await expect(within(canvas.getByRole("combobox", { name: "Display currency" }).closest("li")!).getByText("Country default", { exact: true })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /Português · Country default/ })).toBeVisible();
  },
};
export const CurrencyPickerOpen: Story = { args: { initialCurrencyOpen: true }, play: async ({ canvasElement }) => {
  const page = within(canvasElement.ownerDocument.body);
  const trigger = within(canvasElement).getByRole("combobox", { name: "Display currency" });
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  await expect(await page.findByRole("option", { name: "Country default (Brazilian real)" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("option", { name: "US dollar" })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("option", { name: "Nigerian naira" })).toBeInTheDocument();
  await expect(page.getByRole("option", { name: "Rupiah" })).toBeInTheDocument();
  await expect(page.queryByRole("option", { name: "Brazilian real" })).toBeNull();
} };
export const CountryChangePreservesExplicitChoices: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("combobox", { name: "Display currency" });
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    await userEvent.click(await page.findByRole("option", { name: "US dollar" }));
    await waitFor(async () => {
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.queryByRole("listbox")).toBeNull();
    });
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    await expect(await page.findByRole("option", { name: "US dollar" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    await waitFor(async () => {
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.queryByRole("listbox")).toBeNull();
    });
    await userEvent.click(canvas.getByRole("button", { name: /Country What's available/ }));
    await userEvent.click(await page.findByRole("button", { name: "Nigeria" }));
    await waitFor(() => expect(page.queryByRole("dialog")).toBeNull());
    await expect(trigger).toHaveTextContent("US dollar");
    await expect(canvas.getByText("Chosen by you", { exact: true })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /English · Country default/ })).toBeVisible();
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    await expect(await page.findByRole("option", { name: "Country default (Nigerian naira)" })).toBeInTheDocument();
    await expect(page.queryByRole("option", { name: "Nigerian naira" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(async () => {
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.queryByRole("listbox")).toBeNull();
    });
  },
};
export const ExplicitCurrencyMatchesNewCountryDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("combobox", { name: "Display currency" });
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    await userEvent.click(await page.findByRole("option", { name: "Nigerian naira" }));
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    await userEvent.click(canvas.getByRole("button", { name: /Country What's available/ }));
    await userEvent.click(await page.findByRole("button", { name: "Nigeria" }));
    await waitFor(() => expect(page.queryByRole("dialog")).toBeNull());
    await expect(trigger).toHaveTextContent("Nigerian naira");
    await expect(canvas.getByText("Chosen by you", { exact: true })).toBeVisible();
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    await expect(await page.findByRole("option", { name: "Nigerian naira" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("option", { name: "Country default (Nigerian naira)" })).toHaveAttribute("aria-selected", "false");
  },
};
export const ReturnToCountryDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("combobox", { name: "Display currency" });
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    await userEvent.click(await page.findByRole("option", { name: "US dollar" }));
    await waitFor(async () => {
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.queryByRole("listbox")).toBeNull();
    });
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    await expect(await page.findByRole("option", { name: "Country default (Brazilian real)" })).toBeInTheDocument();
    await userEvent.click(page.getByRole("option", { name: "Country default (Brazilian real)" }));
    await waitFor(async () => {
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.queryByRole("listbox")).toBeNull();
    });
    await expect(within(trigger.closest("li")!).getByText("Country default", { exact: true })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Country What's available/ }));
    await userEvent.click(await page.findByRole("button", { name: "Indonesia" }));
    await waitFor(() => expect(page.queryByRole("dialog")).toBeNull());
    await expect(trigger).toHaveTextContent("Rupiah");
    await expect(within(trigger.closest("li")!).getByText("Country default", { exact: true })).toBeVisible();
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    await expect(await page.findByRole("option", { name: "Country default (Rupiah)" })).toBeInTheDocument();
    await expect(page.queryByRole("option", { name: "Rupiah" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(async () => {
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.queryByRole("listbox")).toBeNull();
    });
  },
};
export const Administrator: Story = { args: { isAdministrator: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  for (const destination of [/Verification/, /Disclosures & terms/, /Operations/]) {
    await expect(canvas.getByRole("button", { name: destination })).toBeVisible();
  }
} };
export const German320: Story = { args: { stressLabels: true }, parameters: { viewport: { defaultViewport: "smallMobile" }, docs: { description: { story: "320px stress viewport; illustrative long labels are not a German translation." } } },
  play: async ({ canvasElement }) => {
    const descriptions = Array.from(canvasElement.querySelectorAll<HTMLElement>("[data-slot=item-description]"));
    await expect(descriptions.length).toBeGreaterThan(0);
    for (const description of descriptions) {
      await expect(description.textContent?.trim().length).toBeGreaterThan(0);
    }
    const displayRow = within(canvasElement).getByText("Währung für die Anzeige der Kontostände").closest<HTMLElement>("[data-slot=item]")!;
    await expect(within(displayRow).getByText("Country default", { exact: true })).toBeVisible();
  } };
export const Rtl: Story = {
  args: { stressLabels: true },
  parameters: { viewport: { defaultViewport: "smallMobile" }, docs: { description: { story: "Illustrative long-string RTL alignment fixture, not a translation." } } },
  decorators: [(Story) => <div dir="rtl"><Story /></div>],
  beforeEach() {
    const previous = document.documentElement.getAttribute("dir");
    document.documentElement.dir = "rtl";
    return () => {
      if (previous === null) document.documentElement.removeAttribute("dir");
      else document.documentElement.setAttribute("dir", previous);
    };
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox", { name: "Display currency" });
    const title = within(trigger.closest("li")!).getByText("Währung für die Anzeige der Kontostände");
    const range = title.ownerDocument.createRange();
    range.selectNodeContents(title);
    const lines = Array.from(range.getClientRects());
    await expect(lines.length).toBeGreaterThan(1);
    const lastLine = lines[lines.length - 1];
    await expect(lastLine.width).toBeLessThan(lines[0].width);
    await expect(Math.abs(title.getBoundingClientRect().right - lastLine.right)).toBeLessThanOrEqual(2);
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    const option = await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Country default (Brazilian real)" });
    await expect(option).toHaveAttribute("aria-selected", "true");
    const indicator = option.querySelector<HTMLElement>('[data-slot="select-item-indicator"]')!;
    await expect(indicator).toHaveAttribute("data-selected");
    await expect(indicator.getBoundingClientRect().left).toBeLessThan(option.getBoundingClientRect().left + option.getBoundingClientRect().width / 2);
  },
};
export const Desktop: Story = { render: (args) => <RegionalShell active={null} title="Account"><RegionalPreferencesProposal {...args} showTitle={false} /></RegionalShell>,
  parameters: { viewport: { defaultViewport: "desktop" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("heading", { level: 1, name: "Account" })).toHaveLength(1);
    await expect(within(canvasElement.querySelector("aside")!).getByRole("button", { name: "Account" })).toHaveAttribute("aria-current", "page");
  } };
