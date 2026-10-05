import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useLayoutEffect, type ReactNode } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { EmailShareSheet } from "./email-share-sheet";

function DocumentDirection({ dir, children }: { dir: "ltr" | "rtl"; children: ReactNode }) {
  useLayoutEffect(() => {
    const previous = document.documentElement.dir;
    document.documentElement.dir = dir;
    return () => { document.documentElement.dir = previous; };
  }, [dir]);
  return children;
}

const meta = {
  id: "account-email-share-sheet",
  title: "Account/Email Share Sheet",
  component: EmailShareSheet,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  args: { open: true, onShare: fn(), onNotNow: fn() },
} satisfies Meta<typeof EmailShareSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

async function sheet() {
  return within(document.body).findByRole("dialog", { name: "Share your email" });
}

export const Default: Story = {
  play: async ({ args }) => {
    const dialog = await sheet();
    const scope = within(dialog);
    await expect(dialog).toHaveAccessibleDescription("Base Account shares it with Home so we can find your account if you need help.");
    const close = scope.getByRole("button", { name: "Close" });
    const share = scope.getByRole("button", { name: "Share" });
    const notNow = scope.getByRole("button", { name: "Not now" });
    await waitForReady(() => expect(close).toHaveFocus());
    await userEvent.tab();
    await expect(share).toHaveFocus();
    await userEvent.tab();
    await expect(notNow).toHaveFocus();
    for (const button of [close, share, notNow]) {
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await userEvent.click(share);
    await expect(args.onShare).toHaveBeenCalledTimes(1);
    await userEvent.click(notNow);
    await expect(args.onNotNow).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    await expect(args.onNotNow).toHaveBeenCalledTimes(2);
  },
};

export const RightToLeft: Story = {
  decorators: [(Story) => <DocumentDirection dir="rtl"><Story /></DocumentDirection>],
  play: async () => {
    const dialog = await sheet();
    const scope = within(dialog);
    const title = scope.getByRole("heading", { name: "Share your email" }).getBoundingClientRect();
    const close = scope.getByRole("button", { name: "Close" }).getBoundingClientRect();
    await expect(close.right).toBeLessThanOrEqual(title.left);
  },
};
