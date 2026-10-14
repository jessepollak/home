import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ArrowUpRight, Landmark, Plus, Send, SendHorizontal } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "@/components/ui/button";
import { HomeOverview } from "@/client/home/home-overview";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import { ActivityPanelView } from "@/client/activity";
import { balance, wallet } from "../../journeys/explorations/home-pull-to-refresh.fixtures";
import { activity, transfers, pendingSend } from "../../journeys/explorations/activity-transfer-runs.fixtures";
import { CompositionShell, compositionShellHandlers } from "../../journeys/explorations/composition-shell";

type CandidateProps = {
  candidate: "a" | "b" | "c" | "d" | "e" | "f";
  rtl: boolean;
  sendOff: boolean;
  unavailable: boolean;
};

function CandidateActions({ candidate, rtl, sendOff, unavailable }: CandidateProps) {
  const routing = useOptionalHomeShellRouting();
  const currentRound = candidate === "d" || candidate === "e" || candidate === "f";
  const labels = rtl
    ? { add: "إضافة الأموال إلى حسابك", cashOut: "سحب الأموال إلى حسابك", send: "إرسال الأموال إلى محفظة أخرى" }
    : { add: "Add money", cashOut: "Cash out", send: "Send" };
  const open = (flow: "add-money" | "cash-out" | "send", opener: HTMLElement) => routing?.setFlow(flow, { opener });
  return <div className="@container w-full space-y-1" dir={rtl ? "rtl" : "ltr"} data-candidate-actions={candidate}>
    <div className={currentRound
      ? sendOff
        ? "grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2 @min-[12rem]:grid-cols-2"
        : candidate === "f"
          ? "grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2 @min-[18rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          : "grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2 @min-[15.25rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
      : "flex items-start gap-2"} data-action-group="">
      <div className={currentRound ? "contents" : "grid min-w-0 flex-1 grid-cols-2 gap-2"} data-main-pair="">
        <Button size="touch" className="min-w-0" onClick={(event) => open("add-money", event.currentTarget)}>
          <Plus data-icon="inline-start" aria-hidden="true" />{labels.add}
        </Button>
        <Button variant="outline" size="touch" className="min-w-0" onClick={(event) => open("cash-out", event.currentTarget)}>
          {currentRound ? <Landmark data-icon="inline-start" aria-hidden="true" /> : null}{labels.cashOut}
        </Button>
      </div>
      {!sendOff && candidate === "b" ? <Button variant="ghost" size="shell-control" aria-label={labels.send}
        onClick={(event) => open("send", event.currentTarget)}><ArrowUpRight aria-hidden="true" /></Button> : null}
      {!sendOff && (candidate === "d" || candidate === "e") ? <Button variant="outline" size="shell-control" className="h-auto justify-self-end" aria-label={labels.send}
        onClick={(event) => open("send", event.currentTarget)}>{candidate === "d" ? <Send aria-hidden="true" /> : <SendHorizontal aria-hidden="true" />}</Button> : null}
      {!sendOff && candidate === "f" ? <Button variant="outline" size="touch" className="min-w-max justify-self-end" aria-label={labels.send}
        onClick={(event) => open("send", event.currentTarget)}><Send data-icon="inline-start" aria-hidden="true" />{rtl ? "إرسال" : labels.send}</Button> : null}
    </div>
    {!sendOff && candidate === "a" ? <Button variant="link" size="touch" onClick={(event) => open("send", event.currentTarget)}>{labels.send}</Button> : null}
    {!sendOff && candidate === "c" ? <Button variant="ghost" size="touch" className="w-full justify-between"
      onClick={(event) => open("send", event.currentTarget)}>{labels.send}<ArrowUpRight data-icon="inline-end" aria-hidden="true" /></Button> : null}
    {unavailable ? <aside aria-label="Fixture: USD payout unavailable" className="px-1 py-2 text-sm text-foreground">
      <p className="font-medium">Fixture · USD payout unavailable</p>
      <p>Cash out to US dollars isn’t available yet. Cash out remains a route-opening entry.</p>
    </aside> : null}
  </div>;
}

function CashOutActionsCandidate(props: CandidateProps) {
  return <CompositionShell>
    <HomeOverview accountKey={wallet.ownerKey} assetBalances={balance} cashRate="4.20% APY" borrowOfferRate="5.10% APR"
      onRetryBalances={() => {}}
      destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }}
      actions={<CandidateActions {...props} />}
      activity={<ActivityPanelView activity={activity(transfers)} operations={[pendingSend]} density="feed" regionId="US" />} />
  </CompositionShell>;
}

const meta = {
  id: "explorations-cash-out-actions",
  title: "Explorations/Cash-out Actions",
  component: CashOutActionsCandidate,
  tags: ["exploration"],
  args: { candidate: "a", rtl: false, sendOff: false, unavailable: false },
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/home" } },
    msw: { handlers: compositionShellHandlers },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    a11y: { test: "error" },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByLabelText("Total balance")).toBeVisible();
    const actions = canvasElement.querySelector<HTMLElement>("[data-candidate-actions]");
    if (!actions) throw new Error("Candidate actions are required");
    const controls = within(actions);
    const addMoney = controls.getByRole("button", { name: args.rtl ? "إضافة الأموال إلى حسابك" : "Add money" });
    const cashOut = controls.getByRole("button", { name: args.rtl ? "سحب الأموال إلى حسابك" : "Cash out" });
    await expect(addMoney).toBeEnabled();
    await expect(cashOut).toBeEnabled();
    await expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth);
    for (const button of controls.getAllByRole("button")) {
      const rect = button.getBoundingClientRect();
      await expect(rect.height).toBeGreaterThanOrEqual(44);
      await expect(rect.width).toBeGreaterThanOrEqual(44);
      await expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
      if (["d", "e", "f"].includes(args.candidate)) {
        await expect(Math.abs(rect.height - addMoney.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
        const group = actions.getBoundingClientRect();
        await expect(rect.left).toBeGreaterThanOrEqual(group.left - 1);
        await expect(rect.right).toBeLessThanOrEqual(group.right + 1);
      }
    }
    const send = controls.queryByRole("button", { name: args.rtl ? "إرسال الأموال إلى محفظة أخرى" : "Send" });
    if (args.sendOff) await expect(send).not.toBeInTheDocument();
    else {
      if (!send) throw new Error("Offered Send control is required");
      await expect(send).toBeVisible();
      await expect(send).toBeEnabled();
      if (["b", "d", "e"].includes(args.candidate)) await expect(send.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }
    if (args.unavailable) await expect(controls.getByLabelText("Fixture: USD payout unavailable")).toBeVisible();
    if (send) {
      await userEvent.click(send);
      await expect(new URL(window.location.href).searchParams.get("flow")).toBe("send");
    }
  },
} satisfies Meta<typeof CashOutActionsCandidate>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ATextLink: Story = {};
export const BCompactIcon: Story = { args: { candidate: "b" } };
export const CQuietRow: Story = { args: { candidate: "c" } };
export const ARtlLong: Story = { args: { rtl: true } };
export const BRtlLong: Story = { args: { candidate: "b", rtl: true } };
export const CRtlLong: Story = { args: { candidate: "c", rtl: true } };
export const ASendOff: Story = { args: { sendOff: true } };
export const BSendOff: Story = { args: { candidate: "b", sendOff: true } };
export const CSendOff: Story = { args: { candidate: "c", sendOff: true } };
export const AUnavailable: Story = { args: { unavailable: true } };
export const BUnavailable: Story = { args: { candidate: "b", unavailable: true } };
export const CUnavailable: Story = { args: { candidate: "c", unavailable: true } };

export const DOutlinedSend: Story = { args: { candidate: "d" } };
export const EHorizontalSend: Story = { args: { candidate: "e" } };
export const FLabelledSend: Story = { args: { candidate: "f" } };
export const DRtlLong: Story = { args: { candidate: "d", rtl: true } };
export const ERtlLong: Story = { args: { candidate: "e", rtl: true } };
export const FRtlLong: Story = { args: { candidate: "f", rtl: true } };
export const DSendOff: Story = { args: { candidate: "d", sendOff: true } };
export const ESendOff: Story = { args: { candidate: "e", sendOff: true } };
export const FSendOff: Story = { args: { candidate: "f", sendOff: true } };
export const DUnavailable: Story = { args: { candidate: "d", unavailable: true } };
export const EUnavailable: Story = { args: { candidate: "e", unavailable: true } };
export const FUnavailable: Story = { args: { candidate: "f", unavailable: true } };
