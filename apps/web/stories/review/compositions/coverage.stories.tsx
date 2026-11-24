import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { CoverageView } from "@/client/coverage/coverage-view";
import { coverageRegistry } from "@/config/coverage";

type CoverageArgs = { search: string; issuer: string; priority: string; home: string; sort: string };
const meta = {
  id: "compositions-coverage",
  title: "Compositions/Coverage",
  args: { search: "", issuer: "", priority: "", home: "", sort: "gdp" },
  render: (args) => <CoverageView query={{ q: args.search, issuer: args.issuer, priority: args.priority, home: args.home, sort: args.sort }} />,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    library: { render: "frame", order: 4 },
    viewport: { viewports: { desktop1440: { name: "1440 × 900", styles: { width: "1440px", height: "900px" } } }, defaultViewport: "desktop1440" },
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
