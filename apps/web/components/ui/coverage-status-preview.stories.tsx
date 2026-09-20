import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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
  parameters: { layout: "centered", a11y: { test: "error" } },
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
