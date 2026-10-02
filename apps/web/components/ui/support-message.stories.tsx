import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { SupportMessageBubble } from "./support-message";

const meta = { id: "ui-support-message", title: "UI/Support message", component: SupportMessageBubble, args: { author: "customer", side: "operator", children: "Message from customer" }, parameters: { a11y: { test: "error" } } } satisfies Meta<typeof SupportMessageBubble>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Customer: Story = { play: async ({ canvasElement }) => { await expect(within(canvasElement).getByText("Message from customer")).toBeVisible(); } };
export const Operator: Story = { args: { author: "operator", side: "operator", children: "Operator reply" } };
export const Assistant: Story = { args: { author: "assistant", side: "customer", children: "Assistant reply" } };
