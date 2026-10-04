import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, ChevronRight, CircleAlertIcon, Landmark, PiggyBank, TrendingUp } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { PullToRefreshAction, PullToRefreshIndicator, usePullToRefresh } from "@/components/ui/pull-to-refresh";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const MONEY = [
  { id: "cash", label: "Cash", detail: "4.10% APY", value: "$8,240.00", icon: PiggyBank, badge: "Earning" },
  { id: "investments", label: "Investments", detail: "3 assets", value: "$4,100.00", icon: TrendingUp, badge: null },
] as const;

const ACTIVITY = [
  { id: "deposit", title: "Deposited to Save", detail: "Today · 9:12 AM", amount: "+$250.00", icon: ArrowDownToLine },
  { id: "send", title: "Sent to alex.base.eth", detail: "Yesterday · 6:40 PM", amount: "−$42.50", icon: ArrowUpRight },
  { id: "interest", title: "Interest", detail: "Sep 9", amount: "+$0.94", icon: PiggyBank },
] as const;

function HomeComposition() {
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(true);
  const refresh = () => setRefreshing(true);
  useEffect(() => {
    if (!refreshing) return;
    let live = true;
    void Promise.resolve().then(() => {
      if (!live) return;
      setRefreshing(false);
      setStale(false);
    });
    return () => { live = false; };
  }, [refreshing]);
  const { phase, indicatorRef, actionRef } = usePullToRefresh({ scrollRef, contentRef, enabled: true, refreshing, onRefresh: refresh });
  return <div className="flex h-svh flex-col bg-muted">
    <header className="shrink-0 border-b bg-background px-4 py-4 font-semibold">Home</header>
    <main ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="Home dashboard">
      <PullToRefreshAction label="Refresh Home" refreshing={refreshing} onRefresh={refresh} actionRef={actionRef} />
      <PullToRefreshIndicator phase={phase} indicatorRef={indicatorRef} />
      <div ref={contentRef} className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
        <span role="status" aria-live="polite" className="sr-only">{refreshing ? "Refreshing Home" : null}</span>
        {stale ? <Alert>
          <AlertIcon><CircleAlertIcon /></AlertIcon>
          <AlertTitle>Balance may be out of date</AlertTitle>
          <AlertDescription>Last updated 9:41 AM.</AlertDescription>
          <AlertAction><Button variant="outline" size="touch" onClick={refresh} disabled={refreshing}>Retry</Button></AlertAction>
        </Alert> : null}
        <Card variant="flush" aria-label="Total balance">
          <CardContent inset="hero">
            <p className="text-sm text-muted-foreground">Total balance</p>
            <p className="text-4xl font-semibold tabular-nums">$12,340.00</p>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-2" aria-label="Money actions">
          <Button size="touch">Add money</Button>
          <Button size="touch" variant="outline">Send</Button>
        </div>
        <section aria-labelledby="composition-home-money">
          <Card className="gap-3">
            <CardHeader><h2 id="composition-home-money" className="text-base leading-6 font-semibold">Your money</h2></CardHeader>
            <CardContent inset="list">
              <ul className="list-none p-0">
                {MONEY.map((row) => <li key={row.id}>
                  <Item variant="flush" render={<a href={`#${row.id}`} aria-label={`${row.label}, ${row.value}`} />}>
                    <ItemMedia variant="icon" aria-hidden="true"><row.icon /></ItemMedia>
                    <ItemContent>
                      <ItemTitle><span className="flex items-center gap-2">{row.label}{row.badge ? <Badge>{row.badge}</Badge> : null}</span></ItemTitle>
                      <ItemDescription lines={1}>{row.detail}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <ItemTitle numeric>{row.value}</ItemTitle>
                      <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                    </ItemActions>
                  </Item>
                  <Separator />
                </li>)}
                <li aria-busy="true">
                  <Item variant="flush">
                    <ItemMedia variant="icon" aria-hidden="true"><Landmark /></ItemMedia>
                    <ItemContent>
                      <ItemTitle>Borrow Cash</ItemTitle>
                      <Skeleton className="h-4 w-24" />
                    </ItemContent>
                    <ItemActions><Skeleton className="h-5 w-16" /><span className="sr-only">Loading Borrow balance</span></ItemActions>
                  </Item>
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>
        <section aria-labelledby="composition-home-activity">
          <Card className="gap-3">
            <CardHeader><h2 id="composition-home-activity" className="text-base leading-6 font-semibold">Activity</h2></CardHeader>
            <CardContent inset="list">
              <ul className="list-none p-0">
                {ACTIVITY.map((row, index) => <li key={row.id}>
                  {index > 0 ? <Separator /> : null}
                  <Item variant="flush" size="sm">
                    <ItemMedia variant="icon" aria-hidden="true"><row.icon /></ItemMedia>
                    <ItemContent>
                      <ItemTitle>{row.title}</ItemTitle>
                      <ItemDescription lines={1}>{row.detail}</ItemDescription>
                    </ItemContent>
                    <ItemActions><ItemTitle numeric>{row.amount}</ItemTitle></ItemActions>
                  </Item>
                </li>)}
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  </div>;
}

const meta = {
  title: "Compositions/Home",
  component: HomeComposition,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 1 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    a11y: { test: "error" },
  },
} satisfies Meta<typeof HomeComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {};
