import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { SUPPORT_CONTRACT_VERSION } from "@/shared/support/contract";
import { OperatorSupportInbox } from "./operator-support-inbox";

const meta = { id: "operator-support-inbox", title: "Operator/Support inbox", component: OperatorSupportInbox, parameters: { viewport: { defaultViewport: "mobile" } } } satisfies Meta<typeof OperatorSupportInbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { transport: { list: async () => ({ version: SUPPORT_CONTRACT_VERSION, conversations: [], nextCursor: null }), conversation: async () => { throw new Error("No conversation"); }, read: async () => {}, reply: async () => { throw new Error("No conversation"); }, status: async () => { throw new Error("No conversation"); }, handler: async () => { throw new Error("No conversation"); } } }, play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByText("No open conversations.")).toBeVisible(); } };
export const Unavailable: Story = { args: { transport: { list: async () => { throw new Error("Support inbox is unavailable."); }, conversation: async () => { throw new Error("Support inbox is unavailable."); }, read: async () => {}, reply: async () => { throw new Error("Support inbox is unavailable."); }, status: async () => { throw new Error("Support inbox is unavailable."); }, handler: async () => { throw new Error("Support inbox is unavailable."); } } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByRole("alert")).toHaveTextContent("Support inbox is unavailable."); await expect(canvas.getByRole("button", { name: "Try again" })).toBeVisible(); } };
