import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import type { IdentityVerificationStatus } from "@/shared/identity/contract";
import { Card, CardContent } from "@/components/ui/card";
import { IdentityRow } from "./identity-row";

const base: IdentityVerificationStatus = {
  state: "not-started", category: "verification-required", action: "start", verifiedAt: null, retryReason: null, supportUrl: null, consentRequired: false,
};
const meta = {
  title: "Account/Identity row",
  component: IdentityRow,
  args: { status: base, onAction: () => {} },
  render: (args) => <Card><CardContent inset="list"><IdentityRow {...args} /></CardContent></Card>,
  play: async ({ canvasElement }) => { await expect(within(canvasElement).getByText("Identity")).toBeVisible(); },
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof IdentityRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NotStarted: Story = {};
export const InProgress: Story = { args: { status: { ...base, state: "in-progress" } } };
export const Pending: Story = { args: { status: { ...base, state: "pending", action: "wait", category: "verification-pending" } } };
export const ManualReview: Story = { args: { status: { ...base, state: "manual-review", action: "wait", category: "verification-pending" } } };
export const Verified: Story = { args: { status: { ...base, state: "verified", action: "none", category: "available", verifiedAt: "2026-09-07T12:00:00.000Z" } } };
export const Retry: Story = { args: { status: { ...base, state: "retry", action: "continue", category: "verification-rejected", retryReason: "photo-quality" } } };
export const Blocked: Story = { args: { status: { ...base, state: "blocked", action: "contact-support", category: "verification-rejected", supportUrl: "https://support.example.com" } } };
export const Rejected: Story = { args: { status: { ...base, state: "rejected", action: "contact-support", category: "verification-rejected", supportUrl: "https://support.example.com" } } };
export const Reset: Story = { args: { status: { ...base, state: "reset", action: "continue" } } };
export const Removed: Story = { args: { status: { ...base, state: "removed" } } };
export const LevelChanged: Story = { args: { status: { ...base, state: "level-changed", action: "continue" } } };
export const TemporarilyUnavailable: Story = { args: { status: { ...base, state: "temporarily-unavailable", category: "temporarily-unavailable", action: "retry" } } };
export const ConfigurationUnavailable: Story = { args: { status: { ...base, state: "configuration-unavailable", category: "configuration-unavailable", action: "none" } } };
