import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { Card, CardContent } from "@/components/ui/card";
import type { IdentityVerificationStatus } from "@/shared/identity/contract";
import { IdentityVerification, type IdentityWallet } from "./identity-verification";

const notStarted: IdentityVerificationStatus = {
  state: "not-started", category: "verification-required", action: "start", verifiedAt: null, retryReason: null, supportUrl: null, consentRequired: true,
};
const inProgress: IdentityVerificationStatus = { ...notStarted, state: "in-progress", action: "continue", consentRequired: false };
function storyWallet(status: IdentityVerificationStatus, sessionResponse: () => Promise<unknown>): IdentityWallet {
  return {
    status: "verified", verification: "server",
    session: { user: { subject: `identity-story-${status.state}` }, smartAccount: null, accountProvider: "cdp-embedded" },
    fetchAccountResource: async (path) => path.endsWith("/session") ? sessionResponse() : { version: 1, status },
  };
}

const meta = {
  title: "Account/Identity sheet",
  component: IdentityVerification,
  args: { wallet: storyWallet(notStarted, async () => ({ version: 1, token: "story-token", status: inProgress })) },
  render: (args) => <Card><CardContent inset="list"><ul><IdentityVerification {...args} /></ul></CardContent></Card>,
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof IdentityVerification>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Consent: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Verify identity" }));
    await expect(await within(document.body).findByText(/Sumsub collects and holds your ID documents/)).toBeVisible();
    await expect(within(document.body).getByRole("link", { name: "Disclosures & terms" })).toBeVisible();
  },
};

export const Loading: Story = {
  args: { wallet: storyWallet(inProgress, () => new Promise(() => {})) },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Continue" }));
    await expect(await within(document.body).findByText("Opening verification…")).toBeVisible();
  },
};

export const HostedRecovery: Story = {
  args: {
    wallet: storyWallet(inProgress, async () => ({ version: 1, token: "story-token", status: inProgress })),
    loadSdk: async () => { throw new Error("Embedded SDK unavailable"); },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Continue" }));
    await expect(await within(document.body).findByRole("button", { name: "Continue in a new tab" })).toBeVisible();
  },
};
