import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { HomePanel } from "@/client/home/home-panel";
import { ProductOfferingProvider } from "@/client/home/product-offering";
import { deploymentProductSettings, resolveProductOffering } from "@/shared/operator-settings/products";
import { cashoutFixtureProviders } from "@/tests/browser/feature-map/cashout-fixture";
import { borrowOverviewBody, savingsVaultsBody } from "@/tests/browser/fixtures/bodies";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { activity, transfers } from "./explorations/activity-transfer-runs.fixtures";
import { CompositionShell, compositionShellHandlers } from "./explorations/composition-shell";
import { balance, wallet } from "./explorations/home-pull-to-refresh.fixtures";
import { availableAssets } from "./explorations/send-recipient.fixtures";

const noop = () => {};
const fetchActivity = async () => {
  const page = activity(transfers).page;
  if (!page) throw new Error("Activity fixture page is required");
  return page;
};
const fetchOperations = async () => ({ actions: [] });

function HomeMoneyActions({ sendOff = false }: { sendOff?: boolean }) {
  const settings = deploymentProductSettings();
  if (sendOff) settings.products.send = "off";
  return <CompositionShell>
    <ProductOfferingProvider value={resolveProductOffering({ kind: "saved", value: settings })}>
      <HomePanel assetBalances={balance} activitySession={wallet.session} sessionSettling={false}
        sendAvailability={availableAssets} fetchActivity={fetchActivity} fetchOperations={fetchOperations}
        onOpenCash={noop} onOpenInvestments={noop} onOpenBorrow={noop} regionId="US" />
    </ProductOfferingProvider>
  </CompositionShell>;
}

const meta = {
  title: "Journeys/Home money actions",
  component: HomeMoneyActions,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/home" } },
    msw: { handlers: [
      ...compositionShellHandlers,
      http.get("/api/funding/providers", () => HttpResponse.json(cashoutFixtureProviders)),
      http.get("/api/savings/vaults", () => HttpResponse.json(savingsVaultsBody("2026-09-15T12:00:00Z", "2026-09-15T12:00:00Z"))),
      http.get("/api/borrow", () => HttpResponse.json(borrowOverviewBody())),
    ] },
    a11y: { test: "error" },
  },
  play: async ({ canvasElement, args }) => {
    const group = within(canvasElement).getByRole("group", { name: "Money actions" });
    const actions = within(group);
    await expect(actions.getAllByRole("button").map((button) => button.textContent)).toEqual(args.sendOff ? ["Cash out"] : ["Cash out", "Send"]);
    const add = actions.getByRole("link", { name: "Add money" });
    await expect(add).toHaveAttribute("href", "/home?flow=add-money");
    for (const control of [add, ...actions.getAllByRole("button")]) {
      const rect = control.getBoundingClientRect();
      await expect(rect.width).toBeGreaterThanOrEqual(44);
      await expect(rect.height).toBeGreaterThanOrEqual(44);
      await expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth);
      await expect(Math.abs(rect.height - add.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    }
    const body = within(canvasElement.ownerDocument.body);
    add.focus();
    await userEvent.tab();
    const cashOut = actions.getByRole("button", { name: "Cash out" });
    await expect(cashOut).toHaveFocus();
    await userEvent.keyboard("[Space]");
    await waitForReady(() => expect(body.getByRole("dialog", { name: "Cash out" })).toBeVisible());
    const cashOutDialog = () => within(body.getByRole("dialog", { name: "Cash out" }));
    await waitForReady(() => expect(cashOutDialog().getByText("Cash out to US dollar isn't available yet")).toBeVisible());
    await expect(new URL(window.location.href).searchParams.get("flow")).toBe("cash-out");
    await expect(cashOutDialog().queryByRole("textbox", { name: "To" })).toBeNull();
    await userEvent.click(cashOutDialog().getByRole("button", { name: "Close cash-out dialog" }));
    await waitForReady(() => expect(body.queryByRole("dialog")).toBeNull());
    if (!args.sendOff) {
      actions.getByRole("button", { name: "Cash out" }).focus();
      await userEvent.tab();
      await expect(actions.getByRole("button", { name: "Send" })).toHaveFocus();
      await userEvent.keyboard("{Enter}");
      await waitForReady(() => expect(body.getByRole("dialog", { name: "Send" })).toBeVisible());
      const sendDialog = () => within(body.getByRole("dialog", { name: "Send" }));
      await waitForReady(() => expect(sendDialog().getByRole("textbox", { name: "Amount" })).toBeVisible());
      await expect(new URL(window.location.href).searchParams.get("flow")).toBe("send");
      await userEvent.click(sendDialog().getByRole("button", { name: "Close send dialog" }));
      await waitForReady(() => expect(body.queryByRole("dialog")).toBeNull());
    }
  },
} satisfies Meta<typeof HomeMoneyActions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Selected: Story = {};
export const SendOff: Story = { args: { sendOff: true } };
