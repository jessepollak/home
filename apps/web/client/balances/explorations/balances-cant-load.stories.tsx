import { useId } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { BalancesCantLoad } from "@/client/balances/balances-cant-load";
import { LoadRetryButton } from "@/components/load-error";
import { shellDesktopContentClassName, shellFrameClassName } from "@/components/shell-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/status-texture";

type Candidate = "baseline" | "quiet" | "inline";
type Surface = "home" | "cash" | "investments";

const surfaces = {
  home: { label: "Total balance", name: "Total balance", figure: "h-10" },
  cash: { label: "Cash", name: "Cash balance", figure: "h-10" },
  investments: { label: "Investments", name: "Investments balance", figure: "h-14" },
} as const;

function QuietCantLoad({ figure, onRetry }: { figure: "h-10" | "h-14"; onRetry: () => void }) {
  const messageId = useId();
  return (
    <div className="flex flex-col gap-1">
      <div aria-hidden="true" data-placeholder="figure" className={`${figure} w-48 rounded-lg bg-muted`} />
      <div role="alert" className="flex flex-col items-start">
        <p id={messageId} className="pt-1 text-sm text-muted-foreground">Can’t load balances</p>
        <Button type="button" variant="ghost" size="sm-touch" className="-ms-2.5 text-sm" onClick={onRetry} aria-describedby={messageId}>
          Try again
        </Button>
      </div>
    </div>
  );
}

function InlineCantLoad({ onRetry }: { onRetry: () => void }) {
  const messageId = useId();
  return (
    <div role="alert" className="flex min-h-11 w-full items-center justify-between gap-3">
      <p id={messageId} className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <StatusMark texture="cant-load" />
        Can’t load balances
      </p>
      <LoadRetryButton onRetry={onRetry} describedBy={messageId} />
    </div>
  );
}

function CantLoadSlot({ candidate, surface, onRetry }: { candidate: Candidate; surface: Surface; onRetry: () => void }) {
  if (candidate === "quiet") return <QuietCantLoad figure={surfaces[surface].figure} onRetry={onRetry} />;
  if (candidate === "inline") return <InlineCantLoad onRetry={onRetry} />;
  return <BalancesCantLoad onRetry={onRetry} />;
}

function CantLoadHero({ candidate, surface, onRetry }: { candidate: Candidate; surface: Surface; onRetry: () => void }) {
  const { label, name } = surfaces[surface];
  return (
    <Card variant="flush" aria-label={name}>
      <CardContent inset="hero">
        {surface === "home" ? (
          <>
            <p className="text-sm text-muted-foreground">{label}</p>
            <div className="@container flex min-h-10 items-center">
              <CantLoadSlot candidate={candidate} surface={surface} onRetry={onRetry} />
            </div>
          </>
        ) : (
          <div className="@container flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <CantLoadSlot candidate={candidate} surface={surface} onRetry={onRetry} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FirstVisitCantLoad({ candidate, surface, onRetry }: { candidate: Candidate; surface: Surface; onRetry: () => void }) {
  return (
    <main className="min-h-dvh bg-muted">
      <div className={`${shellFrameClassName} py-4 sm:py-6`}>
        {surface === "home" ? (
          <div className="space-y-4 lg:grid lg:grid-cols-[minmax(320px,3fr)_minmax(340px,2fr)] lg:items-start lg:gap-6 lg:space-y-0 xl:gap-8">
            <CantLoadHero candidate={candidate} surface={surface} onRetry={onRetry} />
          </div>
        ) : (
          <div className={shellDesktopContentClassName}>
            <CantLoadHero candidate={candidate} surface={surface} onRetry={onRetry} />
          </div>
        )}
      </div>
    </main>
  );
}

const meta = {
  id: "explorations-balances-cant-load",
  title: "Explorations/Balances/Can't load",
  component: FirstVisitCantLoad,
  tags: ["exploration"],
  args: { candidate: "baseline", surface: "home", onRetry: fn() },
  argTypes: {
    candidate: { control: "inline-radio", options: ["baseline", "quiet", "inline"] },
    surface: { control: "inline-radio", options: ["home", "cash", "investments"] },
  },
  parameters: { layout: "fullscreen" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Can’t load balances");
    await expect(canvas.queryByText("—")).toBeNull();
    await userEvent.tab();
    const retry = canvas.getByRole("button", { name: "Try again" });
    await expect(retry).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onRetry).toHaveBeenCalledTimes(1);
  },
} satisfies Meta<typeof FirstVisitCantLoad>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BaselineHome: Story = { args: { candidate: "baseline", surface: "home" } };
export const BaselineCash: Story = { args: { candidate: "baseline", surface: "cash" } };
export const BaselineInvestments: Story = { args: { candidate: "baseline", surface: "investments" } };
export const QuietHome: Story = { args: { candidate: "quiet", surface: "home" } };
export const QuietCash: Story = { args: { candidate: "quiet", surface: "cash" } };
export const QuietInvestments: Story = { args: { candidate: "quiet", surface: "investments" } };
export const InlineHome: Story = { args: { candidate: "inline", surface: "home" } };
export const InlineCash: Story = { args: { candidate: "inline", surface: "cash" } };
export const InlineInvestments: Story = { args: { candidate: "inline", surface: "investments" } };
