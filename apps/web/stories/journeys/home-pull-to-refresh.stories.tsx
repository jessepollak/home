import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useRef, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { HomeOverview, HomeSectionHeading } from "@/client/home/home-overview";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PullToRefreshAction, PullToRefreshIndicator, type PullToRefreshPhase } from "@/components/ui/pull-to-refresh";
import { balance } from "./explorations/home-pull-to-refresh.fixtures";

type Scenario = "idle" | "pulling" | "armed" | "loading" | "success" | "partial" | "failed" | "interactive";
let finishRefresh: (() => void) | null = null;

function HomeRefreshJourney({ scenario }: { scenario: Scenario }) {
  const [current, setCurrent] = useState<Scenario>(scenario);
  const nextOutcome = useRef<"failed" | "success">("failed");
  const phase: PullToRefreshPhase = current === "pulling" || current === "armed" ? current :
    current === "loading" ? "refreshing" : current === "success" ? "settling" : "idle";
  const refresh = () => {
    setCurrent("loading");
    finishRefresh = () => {
      setCurrent(nextOutcome.current);
      nextOutcome.current = "success";
    };
  };
  return (
    <div className="flex h-svh flex-col bg-muted">
      <header className="shrink-0 border-b bg-background px-4 py-4 font-semibold">Home</header>
      <main className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="Home dashboard">
        <PullToRefreshAction label="Refresh Home" refreshing={current === "loading"} onRefresh={refresh} />
        <PullToRefreshIndicator phase={phase} />
        <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-4" style={{ transform: current === "pulling" ? "translateY(24px)" : current === "armed" ? "translateY(68px)" : current === "loading" ? "translateY(52px)" : undefined }}>
          <span role="status" aria-live="polite" className="sr-only">{current === "loading" ? "Refreshing Home" : current === "success" ? "Home updated" : null}</span>
          {current === "partial" || current === "failed" ? (
            <Alert role="alert">
              <AlertDescription>{current === "failed" ? "Couldn't refresh Home." : "Some of Home didn't refresh."}</AlertDescription>
              <AlertAction><Button variant="outline" size="touch" onClick={refresh}>Retry</Button></AlertAction>
            </Alert>
          ) : null}
          <HomeOverview
            accountKey="refresh-story-owner"
            assetBalances={balance}
            cashRate={null}
            borrowOfferRate={null}
            destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }}
            actions={<><Button size="touch">Add money</Button><Button size="touch" variant="outline">Send</Button></>}
            activity={<section aria-labelledby="home-refresh-activity"><Card><CardHeader><HomeSectionHeading id="home-refresh-activity">Activity</HomeSectionHeading></CardHeader><CardContent>No activity yet</CardContent></Card></section>}
          />
        </div>
      </main>
    </div>
  );
}

const meta = {
  title: "Journeys/Home Pull to Refresh",
  component: HomeRefreshJourney,
  args: { scenario: "idle" },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" }, a11y: { test: "error" } },
} satisfies Meta<typeof HomeRefreshJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Pulling: Story = { args: { scenario: "pulling" } };
export const Armed: Story = { args: { scenario: "armed" } };
export const Loading: Story = {
  args: { scenario: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const action = canvas.getByRole("button", { name: "Refresh Home" });
    await expect(action).toHaveAttribute("aria-busy", "true");
    await expect(action.textContent).toBe("");
    await expect(Math.max(action.getBoundingClientRect().width, action.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    const indicator = canvasElement.querySelector<HTMLElement>("[data-slot='pull-to-refresh-indicator']")!;
    await expect(indicator).toBeVisible();
    const firstCard = canvas.getByLabelText("Total balance");
    await expect(indicator.getBoundingClientRect().bottom).toBeLessThan(firstCard.getBoundingClientRect().top);
  },
};
export const KeyboardFocus: Story = {
  args: { scenario: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const action = canvas.getByRole("button", { name: "Refresh Home" });
    await userEvent.tab();
    await expect(action).toHaveFocus();
    await expect(action).toHaveAttribute("aria-busy", "true");
    await expect(action).toHaveAttribute("aria-disabled", "true");
    await expect(action.textContent).toBe("");
    await expect(action.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(1);
    await expect(action).toBeVisible();
    const indicator = canvasElement.querySelector<HTMLElement>("[data-slot='pull-to-refresh-indicator']")!;
    await expect(indicator).not.toBeVisible();
    await expect(action.getBoundingClientRect().toJSON()).toMatchObject({
      x: indicator.getBoundingClientRect().x,
      width: indicator.getBoundingClientRect().width,
      height: indicator.getBoundingClientRect().height,
    });
  },
};
export const SuccessSettling: Story = { args: { scenario: "success" } };
export const PartialFailure: Story = { args: { scenario: "partial" } };
export const Failed: Story = { args: { scenario: "failed" } };
export const RefreshAndRetry: Story = {
  args: { scenario: "interactive" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole("button", { name: "Refresh Home" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitForReady(() => expect(canvas.getByRole("status")).toHaveTextContent("Refreshing Home"));
    finishRefresh?.();
    await waitForReady(() => expect(canvas.getByRole("alert")).toHaveTextContent("Couldn't refresh Home."));
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await waitForReady(() => expect(canvas.getByRole("status")).toHaveTextContent("Refreshing Home"));
    finishRefresh?.();
    await waitForReady(() => expect(canvas.getByRole("status")).toHaveTextContent("Home updated"));
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};
