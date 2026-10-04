import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { isValidElement } from "react";
import { expect, within } from "storybook/test";
import CoveragePage from "@/app/coverage/page";
import { coverageRegistry } from "@/config/coverage";

type CoverageArgs = { search: string; issuer: string; priority: string; home: string; sort: string };
const meta = {
  title: "Compositions/Coverage",
  args: { search: "", issuer: "", priority: "", home: "", sort: "gdp" },
  loaders: [async ({ args }: { args: CoverageArgs }) => ({ page: await CoveragePage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({ q: args.search, issuer: args.issuer, priority: args.priority, home: args.home, sort: args.sort }),
  }) })],
  render: (_args, { loaded }: { loaded: Record<string, unknown> }) => {
    if (!isValidElement(loaded.page)) throw new Error("Coverage page did not return content");
    return loaded.page;
  },
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 8 },
    viewport: { viewports: { desktop1280: { name: "1280 × 800", styles: { width: "1280px", height: "800px" } } }, defaultViewport: "desktop1280" },
  },
} satisfies Meta<CoverageArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Coverage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Local money coverage" })).toBeVisible();
    await expect(canvas.getByText(`Showing ${coverageRegistry.length} of ${coverageRegistry.length} countries and territories.`)).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Download CSV" })).toBeVisible();
  },
};
export const CountrySearch: Story = { args: { search: "Brazil" } };
export const Priority: Story = { args: { priority: "priority" } };
export const Empty: Story = {
  args: { search: "nothing-found" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(`Showing 0 of ${coverageRegistry.length} countries and territories.`)).toBeVisible();
  },
};
