import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ArrowRight, Banknote, Wallet } from "lucide-react";
import { expect, waitFor, within } from "storybook/test";
import { MoneyConfirmSummary, moneyConfirmFromRow } from "@/client/money-modal/confirm-summary";
import { MoneyModalBody } from "@/client/money-modal/money-modal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CurrencyMark, GlyphMark } from "@/components/currency-mark";
import { BalanceRow } from "@/components/finance-rows";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { PayoutMark } from "@/components/ui/payout-mark";
import { borrowPosition, buildBalancesSnapshotFixture, priced, pricedCash, ready } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { RegionalHomeProposal } from "./regional-home";
import { presentationRegions } from "@/config/regions";

const noop = () => undefined;
const proposedCenteredPlacement = "lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[calc(100svh-3rem)] lg:w-[calc(100%-2rem)] lg:max-w-120 lg:rounded-xl lg:border lg:after:hidden lg:data-[placement=centered]:[--closed-transform:translate3d(0,0.5rem,0)] lg:data-starting-style:opacity-0 lg:data-ending-style:opacity-0 lg:[&_[data-slot=drawer-swipe-handle]]:hidden";
type Method = { label: string; context: string; mark: React.ReactNode; unavailable?: boolean };
const wallet: Method = { label: "From a crypto wallet", context: "USDC on Base", mark: <GlyphMark size="sm"><Wallet /></GlyphMark> };
const apple: Method = { label: "Apple Pay", context: "Deposit with a debit card", mark: <GlyphMark size="sm"><Banknote /></GlyphMark> };
function MethodSheet({ title, methods }: { title: string; methods: Method[] }) {
  return (
    <div className="min-h-svh bg-muted/30 p-4">
      <Drawer defaultOpen>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>{title}</DrawerTitle></DrawerHeader>
          <ul className="list-none px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {methods.map(({ label, context, mark, unavailable }) => (
              <BalanceRow key={label} icon={mark} iconTone="mark" label={label} context={context}
                valueTone={unavailable ? "muted" : "default"} chevron={!unavailable}
                onActivate={unavailable ? undefined : noop} activateLabel={`Choose ${label}`} />
            ))}
          </ul>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
function UnavailableSheet({ regionId }: { regionId: "BR" | "NG" | "ID" }) {
  return (
    <div className="min-h-svh bg-muted/30 p-4">
      <Drawer defaultOpen>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Cash out</DrawerTitle></DrawerHeader>
          <Empty className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <EmptyHeader><EmptyTitle>Cash out to {presentationRegions[regionId].currency.name} isn&apos;t available yet</EmptyTitle>
              <EmptyDescription>You can still send USDC to any wallet.</EmptyDescription></EmptyHeader>
            <Button size="lg" className="min-h-11" onClick={noop}>Send instead <ArrowRight aria-hidden="true" /></Button>
          </Empty>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
const reviewBalances = presentBalances({ status: "ready", snapshot: buildBalancesSnapshotFixture({
  region: "US", registry: { usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") } },
  borrow: { coverage: "complete", positions: [borrowPosition({
    collateralBaseUnits: "100000", collateralValue: priced("USD", "7821"),
    debtBaseUnits: "30010000", debtValue: priced("USD", "3001"),
  })] },
}), error: null });
const reviewActivity: UseActivityResult = {
  status: "ready", page: { walletAddress: "0x1111111111111111111111111111111111111111", chainId: 8453, currency: "USD",
    window: { from: "2026-08-23T12:00:00.000Z", to: "2026-09-23T12:00:00.000Z" },
    transfers: [], nextCursor: null, source: { provider: "cdp-sql", cached: false, stale: false,
      executionTimestamp: "2026-09-23T12:00:00.000Z", executionTimeMs: 1, fetchedAt: "2026-09-23T12:00:00.000Z" } },
  loadingMore: false, loadMoreError: false, continuing: false,
  retry: noop, refresh: noop, setSentinelVisible: noop, retryLoadMore: noop,
};
const reviewOwner = { subject: "fixture-subject", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "base-account" } as const;
function ReviewDesktop() {
  return (
    <>
      <RegionalHomeProposal regionId="US" assetBalances={reviewBalances} activity={reviewActivity} onOpenAccount={noop} onReload={noop} />
      <Drawer defaultOpen showSwipeHandle>
        <DrawerContent data-placement="centered" className={proposedCenteredPlacement}>
          <DrawerHeader><DrawerTitle>Review cash out</DrawerTitle></DrawerHeader>
          <MoneyModalBody hasFooter>
            <div className="mx-auto w-full max-w-120 pt-4 [&_[data-slot=money-ticker]]:[direction:ltr] [&_[data-slot=money-ticker]]:[unicode-bidi:isolate]">
              <MoneyConfirmSummary amount="$25.00" lead="Cash out to Zelle" rows={[
                { label: "Provider", value: "Peer" }, { label: "Payout app", value: "Zelle" },
                { label: "Payout handle", value: <bdi dir="ltr">alex@example.com</bdi> },
                moneyConfirmFromRow(reviewOwner), { label: "Asset", value: "USDC" }, { label: "Network", value: "Base" },
                { label: "Provider fee", value: <bdi dir="ltr">$0.75</bdi> }, { label: "Approximate receive", value: <bdi dir="ltr">≈ 24.25 USD</bdi> },
                { label: "Estimated delivery", value: "About 15 min" },
              ]} />
              <Alert role="status" className="mt-4"><AlertDescription>The fiat amount and delivery time are approximate, not guaranteed.</AlertDescription></Alert>
            </div>
          </MoneyModalBody>
          <DrawerFooter><div className="mx-auto flex w-full max-w-md flex-col gap-2">
            <Button size="lg" className="min-h-11 w-full" onClick={noop}>Cash out</Button>
            <DrawerClose render={<Button variant="outline" size="lg">Back</Button>} />
          </div></DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
const meta = {
  id: "explorations-regional-money-sheets", title: "Explorations/Regional money sheets", component: MethodSheet,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" },
    docs: { description: { component: "Unreviewed #638 method and review proposal. Routes, amounts and fees are illustrative fixed fixtures; controls do not start money actions. Desktop review composes the existing MoneyConfirmSummary over Regional Home in a proposed centered placement that exists only in this story file, passed to the unchanged shared DrawerContent through className, without a MoneyModal state machine or action id. It moves into the shared Drawer only if Jesse selects it." } },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=311-12034" } },
} satisfies Meta<typeof MethodSheet>;
export default meta;
type Story = StoryObj<typeof meta>;
const checkDepositCopy = async (expected: string) => {
  const dialog = await waitFor(() => within(document.body).getByRole("dialog", { name: "Add money" }));
  await expect(within(dialog).getByText(expected)).toBeVisible();
  const methodCopy = dialog.querySelectorAll<HTMLElement>("[data-slot=finance-row-body] [data-slot=item-title], [data-slot=finance-row-body] [data-slot=item-description]");
  await expect(methodCopy.length).toBeGreaterThan(0);
  for (const text of methodCopy) await expect(text.textContent?.trim().startsWith("Pay ")).toBe(false);
};
export const AddMoneyUs: Story = { args: { title: "Add money", methods: [apple, wallet] }, play: async () => {
  await checkDepositCopy("Deposit with a debit card");
} };
export const AddMoneyBrazil: Story = { args: { title: "Add money", methods: [
  { label: "Deposit Brazilian real", context: "Through Ripio", mark: <CurrencyMark currency="BRL" size="sm" /> }, wallet,
] }, play: async () => { await checkDepositCopy("Deposit Brazilian real"); } };
export const AddMoneyNigeria: Story = { args: { title: "Add money", methods: [wallet,
  { label: "Deposit Nigerian naira", context: "Not available yet", mark: <CurrencyMark currency="NGN" size="sm" />, unavailable: true },
] } };
export const AddMoneyIndonesia: Story = { args: { title: "Add money", methods: [
  { label: "Deposit rupiah", context: "Through IDRX", mark: <CurrencyMark currency="IDR" size="sm" /> }, wallet,
] } };
export const CashOutUs: Story = { args: { title: "Cash out", methods: [
  { label: "Cash App", context: "To your Cash App balance", mark: <PayoutMark variant="cashapp">$</PayoutMark> },
  { label: "Zelle", context: "To your bank", mark: <PayoutMark variant="zelle">Z</PayoutMark> },
] } };
const unavailableStory = (regionId: "BR" | "NG" | "ID"): Story => ({
  args: { title: "Cash out", methods: [] }, render: () => <UnavailableSheet regionId={regionId} />,
  play: async () => {
    const dialog = await waitFor(() => within(document.body).getByRole("dialog", { name: "Cash out" }));
    await expect(within(dialog).getByText(`Cash out to ${presentationRegions[regionId].currency.name} isn't available yet`)).toBeVisible();
    await expect(within(dialog).getByText("You can still send USDC to any wallet.")).toBeVisible();
  },
});
export const CashOutUnavailable: Story = unavailableStory("NG");
export const CashOutUnavailableBrazil: Story = unavailableStory("BR");
export const CashOutUnavailableIndonesia: Story = unavailableStory("ID");
export const CashOutReviewDesktop: Story = { args: { title: "Cash out", methods: [] }, render: () => <ReviewDesktop />,
  play: async () => {
    const dialog = await waitFor(() => within(document.body).getByRole("dialog", { name: "Review cash out" }));
    await expect(within(dialog).getByText("Provider").nextElementSibling).toHaveTextContent("Peer");
    await expect(within(dialog).getByText("Payout app").nextElementSibling).toHaveTextContent("Zelle");
    await expect(within(dialog).getByText("Payout handle")).toBeVisible();
    await expect(within(dialog).getByText("alex@example.com")).toBeVisible();
    await expect(within(dialog).getByText("Network")).toBeVisible();
    await expect(within(dialog).getByText("Base")).toBeVisible();
    await expect(within(dialog).getByText("Approximate receive")).toBeVisible();
    await expect(within(dialog).getByText("≈ 24.25 USD")).toBeVisible();
    await expect(within(dialog).getByText("Estimated delivery")).toBeVisible();
    await expect(within(dialog).getByText("About 15 min")).toBeVisible();
    await expect(within(dialog).getByText("Asset")).toBeVisible();
    await expect(dialog).toHaveAttribute("data-placement", "centered");
    const handle = dialog.querySelector<HTMLElement>("[data-slot=drawer-swipe-handle]");
    await expect(handle).not.toBeNull();
    await expect(handle).not.toBeVisible();
  },
  parameters: { viewport: { defaultViewport: "desktop" }, docs: { description: { story: "Storybook renders the proposed story-local centered 480px placement at desktop width, matching Figma frame `313:12047`." } } } };
export const CashOutReviewDesktopShort: Story = {
  ...CashOutReviewDesktop,
  play: async (context) => {
    await CashOutReviewDesktop.play?.(context);
    const dialog = within(document.body).getByRole("dialog", { name: "Review cash out" });
    const body = within(dialog).getByText("Estimated delivery").closest<HTMLElement>("[data-slot=money-modal-body]");
    await expect(body).not.toBeNull();
    if (!body) return;
    await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    const back = within(dialog).getByRole("button", { name: "Back" });
    await expect(back.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  },
  parameters: { viewport: { defaultViewport: "shortDesktop", viewports: {
    shortDesktop: { name: "Short desktop (1280 × 480)", styles: { width: "1280px", height: "480px" } },
  } } },
};
