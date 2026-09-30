import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { SignInStatus } from "./sign-in-shell";

const noop = () => {};

const meta = {
  id: "account-sign-in-status",
  title: "Account/Sign-in Status",
  component: SignInStatus,
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: {
    cleaningUp: false,
    checking: true,
    signOutError: false,
    unavailable: false,
    onRetrySignOut: noop,
    onRetryValidation: noop,
  },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
} satisfies Meta<typeof SignInStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const VerifyingSession: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status").textContent).toContain("In progress: Verifying your session…");
    await expect(canvas.getAllByRole("listitem")).toHaveLength(1);
  },
};

export const SigningOut: Story = {
  args: { cleaningUp: true, checking: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status").textContent).toContain("Finishing sign-out…");
  },
};
