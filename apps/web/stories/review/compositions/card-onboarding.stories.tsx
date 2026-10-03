import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { CircleAlert, CreditCard, Lock } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";
import { Alert, AlertAction, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FeatureIntro } from "@/components/ui/feature-intro";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusStep, StatusSteps, type StepStatus } from "@/components/ui/status-step";

type Stage = "not-enrolled" | "verification-required" | "verification-pending" | "ready-to-issue" | "active";

const STEPS = ["Card requested", "Verify your identity", "Checking your details", "Card ready"] as const;
const PROGRESS: Record<Exclude<Stage, "not-enrolled" | "active">, readonly StepStatus[]> = {
  "verification-required": ["complete", "current", "upcoming", "upcoming"],
  "verification-pending": ["complete", "complete", "current", "upcoming"],
  "ready-to-issue": ["complete", "complete", "complete", "current"],
};

const NEXT: Record<Stage, Stage> = {
  "not-enrolled": "verification-required",
  "verification-required": "verification-pending",
  "verification-pending": "ready-to-issue",
  "ready-to-issue": "active",
  active: "active",
};

function CardArt() {
  return <div role="img" aria-label="Virtual card ending 4821"
    className="flex h-44 w-70 max-w-full shrink-0 flex-col justify-between rounded-lg border border-foreground bg-foreground p-4 text-background">
    <div className="flex items-start justify-between gap-2">
      <span className="size-3 rounded-sm bg-primary" />
      <span className="ml-auto text-xs">Virtual</span>
    </div>
    <span className="font-mono text-sm">•••• 4821</span>
  </div>;
}

function CardProgress({ stage, onAdvance }: { stage: keyof typeof PROGRESS; onAdvance: () => void }) {
  const steps = PROGRESS[stage];
  const done = steps.filter((status) => status === "complete").length;
  return <section className="flex flex-col gap-4" aria-labelledby="composition-card-progress">
    <h2 id="composition-card-progress" className="px-4 text-base leading-6 font-semibold">Getting your card</h2>
    <Card><CardContent><Progress label={STEPS[done] ?? "Card ready"} value={done} max={STEPS.length} /></CardContent></Card>
    <StatusSteps>
      {STEPS.map((title, index) => <StatusStep key={title} title={title} status={steps[index] ?? "upcoming"} />)}
    </StatusSteps>
    {stage === "verification-required" ? <Button size="touch" className="w-full" onClick={onAdvance}>Verify</Button> : null}
    {stage === "verification-pending" ? <Alert>
      <AlertIcon><CircleAlert /></AlertIcon>
      <AlertTitle>Checking your details</AlertTitle>
      <AlertDescription>This usually takes a few minutes.</AlertDescription>
      <AlertAction><Button variant="outline" size="touch" onClick={onAdvance}>Refresh</Button></AlertAction>
    </Alert> : null}
    {stage === "ready-to-issue" ? <Button size="touch" className="w-full" onClick={onAdvance}>Create your card</Button> : null}
  </section>;
}

function Spending({ active }: { active: boolean }) {
  return <section aria-labelledby="composition-card-spending">
    <Card className="gap-3">
      <CardHeader><h2 id="composition-card-spending" className="text-base leading-6 font-semibold">Spending</h2></CardHeader>
      <CardContent inset="list">
        <Item aria-busy="true">
          <ItemContent>
            <ItemTitle>Available to spend</ItemTitle>
            <Skeleton className="h-4 w-20" />
            <span className="sr-only">Loading available to spend</span>
          </ItemContent>
        </Item>
        <Separator />
        <Item>
          <ItemContent>
            <ItemTitle>Spending limit</ItemTitle>
            <ItemDescription>{active ? "Unlimited" : "Not available yet"}</ItemDescription>
          </ItemContent>
          <ItemActions><Button variant="ghost" size="sm-touch" disabled={!active}>Set limit</Button></ItemActions>
        </Item>
      </CardContent>
    </Card>
  </section>;
}

function CardOnboardingComposition({ initial = "not-enrolled" }: { initial?: Stage }) {
  const [stage, setStage] = useState<Stage>(initial);
  const [failed, setFailed] = useState(true);
  const advance = () => {
    setFailed(false);
    setStage((current) => NEXT[current]);
  };
  return <div className="flex h-svh flex-col bg-muted">
    <header className="shrink-0 border-b bg-background px-4 py-4 font-semibold">Card</header>
    <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="Card">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
        {failed && (stage === "not-enrolled" || stage === "verification-required") ? <Alert variant="destructive">
          <AlertIcon><CircleAlert /></AlertIcon>
          <AlertTitle>Couldn&apos;t start verification</AlertTitle>
          <AlertDescription>Try again.</AlertDescription>
        </Alert> : null}
        {stage === "not-enrolled" ? <FeatureIntro
          headline="Spend your Cash with a card"
          illustration="card"
          benefits={[
            { icon: CreditCard, text: "Spend online anywhere cards work" },
            { icon: Lock, text: "Lock it anytime" },
          ]}
          primary={{ label: "Get your card", onClick: advance }}
        /> : null}
        {stage === "verification-required" || stage === "verification-pending" || stage === "ready-to-issue"
          ? <CardProgress stage={stage} onAdvance={advance} /> : null}
        {stage === "active" ? <Card variant="flush">
          <CardContent inset="hero"><div className="flex justify-center"><CardArt /></div></CardContent>
        </Card> : null}
        <Spending active={stage === "active"} />
      </div>
    </main>
  </div>;
}

const meta = {
  title: "Compositions/Card Onboarding",
  component: CardOnboardingComposition,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 6 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    a11y: { test: "error" },
  },
} satisfies Meta<typeof CardOnboardingComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CardOnboarding: Story = {
  name: "Card Onboarding",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Couldn't start verification");
    await expect(canvas.getByRole("heading", { name: "Spend your Cash with a card" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Set limit" })).toBeDisabled();
    const start = canvas.getByRole("button", { name: "Get your card" });
    start.focus();
    await expect(start).toHaveFocus();
  },
};

export const CardVerification: Story = {
  name: "Card Verification",
  args: { initial: "verification-pending" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("progressbar", { name: "Checking your details" })).toHaveAttribute("aria-valuenow", "2");
    await expect(canvas.getByRole("alert")).toHaveTextContent("Checking your details");
    const refresh = canvas.getByRole("button", { name: "Refresh" });
    refresh.focus();
    await expect(refresh).toHaveFocus();
  },
};

export const CardIssued: Story = {
  name: "Card Issued",
  args: { initial: "ready-to-issue" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Create your card" }));
    await expect(canvas.getByRole("img", { name: "Virtual card ending 4821" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Set limit" })).toBeEnabled();
  },
};
