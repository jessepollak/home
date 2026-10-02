import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CoverageStatusPreview } from "./coverage-status-preview";

const meta = {
  id: "ui-coverage-status-preview",
  title: "UI/Coverage Status Preview",
  component: CoverageStatusPreview,
  args: {
    status: "Yellow",
    accessibleName: "Yellow — Stablecoin candidate identified",
    heading: "Brazil stablecoin candidate",
    details: [
      { label: "Status", value: "Identified" },
      { label: "Candidate asset", value: "BRZ" },
      { label: "Issuer", value: "Transfero" },
    ],
  },
  parameters: {
    layout: "centered",
    a11y: { test: "error", context: { include: ["body"], exclude: ["[data-base-ui-focus-guard]"] } },
  },
} satisfies Meta<typeof CoverageStatusPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Identified: Story = {};

export const NotIdentified: Story = {
  args: {
    status: "Red",
    accessibleName: "Red — No stablecoin candidate identified",
    heading: "Vanuatu stablecoin candidate",
    details: [{ label: "Status", value: "Not identified" }],
  },
};

export const HollowIndicator: Story = {
  args: { indicatorVariant: "hollow" },
};

export const HoverOpen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole("button"));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole("heading", { name: "Brazil stablecoin candidate" })).toBeVisible());
  },
};
