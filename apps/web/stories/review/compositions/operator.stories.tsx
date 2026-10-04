import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { http, HttpResponse } from "msw";
import { expect, within } from "storybook/test";
import { OperatorShell } from "@/app/admin/operator-shell";
import { SUPPORT_CONTRACT_VERSION, type OperatorSupportSummary } from "@/shared/support/contract";
import { ACCOUNT } from "@/stories/journeys/explorations/send-recipient.fixtures";

const summary = { version: SUPPORT_CONTRACT_VERSION, unreadConversations: 3 } satisfies OperatorSupportSummary;
const meta = {
  id: "compositions-operator",
  title: "Compositions/Operator",
  component: OperatorShell,
  args: { address: ACCOUNT, children: null },
  beforeEach: () => {
    getRouter().refresh.mockImplementation(async () => {});
  },
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 9 },
    viewport: { viewports: { desktop1440: { name: "1440 × 900", styles: { width: "1440px", height: "900px" } } }, defaultViewport: "desktop1440" },
    nextjs: { navigation: { pathname: "/admin/support", segments: ["(sections)", "support"] } },
    msw: { handlers: [http.get("*/api/admin/support/summary", () => HttpResponse.json(summary))] },
  },
} satisfies Meta<typeof OperatorShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Operator: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sidebar = within(canvas.getByRole("complementary", { name: "Operator sidebar" }));
    const support = await sidebar.findByRole("link", { name: /Support/ });
    await expect(support).toHaveAttribute("href", "/admin/support");
    await expect(support).toHaveAttribute("aria-current", "page");
    await expect(await sidebar.findByText("3")).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/home");
    await expect(await sidebar.findByRole("button", { name: /Copy/ })).toBeVisible();
  },
};
