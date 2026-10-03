import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ChartNoAxesCombined, ChevronLeft, ChevronRight, CircleAlertIcon, CreditCard, House, Search } from "lucide-react";
import { Alert, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { RailNavItem } from "@/components/ui/rail-nav";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const ASSETS = [
  { id: "cbbtc", name: "Bitcoin", symbol: "cbBTC", kind: "Crypto", price: "$122,391.18", change: "+4.1%", gain: true, detail: null },
  { id: "aaplc", name: "Apple", symbol: "AAPLc", kind: "Stock", price: "$231.40", change: "+0.8%", gain: true, detail: null },
  { id: "orbit-1", name: "Orbit", symbol: "ORB", kind: "Crypto", price: "$1.25", change: "+2.4%", gain: true, detail: "0x1111…1111" },
  { id: "orbit-2", name: "Orbit", symbol: "ORB", kind: "Crypto", price: "$0.04", change: "−12.0%", gain: false, detail: "0x3333…3333" },
  { id: "eth", name: "Ethereum", symbol: "ETH", kind: "Crypto", price: "$4,512.07", change: "−1.3%", gain: false, detail: null },
  { id: "nvdac", name: "NVIDIA", symbol: "NVDAc", kind: "Stock", price: "$182.65", change: "+1.9%", gain: true, detail: null },
] as const;
type Asset = (typeof ASSETS)[number];

const RANGES = ["1D", "1W", "1M", "1Y"] as const;
type Range = (typeof RANGES)[number];
const RANGE_NAMES = { "1D": "1 day", "1W": "1 week", "1M": "1 month", "1Y": "1 year" } as const;
const SERIES = {
  "1D": [62, 60, 64, 63, 66, 65, 68, 70, 69, 72],
  "1W": [40, 46, 44, 52, 50, 58, 61, 59, 66, 72],
  "1M": [70, 62, 58, 50, 54, 47, 52, 60, 64, 72],
  "1Y": [12, 20, 18, 30, 34, 28, 45, 52, 60, 72],
} as const;
const PAGE_SIZE = 4;

function isRange(value: unknown): value is Range {
  return RANGES.some((range) => range === value);
}

function points(range: Range): string {
  const series = SERIES[range];
  return series.map((value, index) => `${(index / (series.length - 1)) * 100},${80 - value}`).join(" ");
}

function Rail() {
  return <aside className="flex w-52 shrink-0 flex-col gap-4 border-e bg-background py-4">
    <p className="px-4 text-base font-semibold">Home</p>
    <nav aria-label="Main navigation" className="flex flex-col">
      <RailNavItem href="#home" label="Home" icon={House} />
      <RailNavItem href="#card" label="Card" icon={CreditCard} />
      <RailNavItem href="#invest" label="Invest" icon={ChartNoAxesCombined} current />
    </nav>
  </aside>;
}

function AssetRow({ asset, selected, onOpen }: { asset: Asset; selected: boolean; onOpen: () => void }) {
  return <Item variant="flush" render={<button type="button" aria-label={`${asset.name}, ${asset.detail ?? asset.symbol}, ${asset.price}, ${asset.change}`} aria-current={selected || undefined} onClick={onOpen} />}>
    <ItemMedia variant="avatar" aria-hidden="true">{asset.name.slice(0, 1)}</ItemMedia>
    <ItemContent>
      <ItemTitle><span className="flex items-center gap-2">{asset.name}<Badge variant="outline">{asset.kind}</Badge></span></ItemTitle>
      <ItemDescription lines={1}>{asset.detail ? `${asset.symbol} · ${asset.detail}` : asset.symbol}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <span className="flex flex-col items-end">
        <ItemTitle numeric>{asset.price}</ItemTitle>
        <ItemTitle numeric tone={asset.gain ? "gain" : "destructive"}>{asset.change}</ItemTitle>
      </span>
    </ItemActions>
  </Item>;
}

function AssetDetail({ asset }: { asset: Asset }) {
  const [range, setRange] = useState<Range>("1W");
  return <section aria-labelledby="composition-invest-asset">
    <Card>
      <CardHeader>
        <CardTitle><h2 id="composition-invest-asset">{asset.name}</h2></CardTitle>
        <CardAction><Badge variant={asset.gain ? "secondary" : "destructive"}>{asset.change}</Badge></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-3xl font-semibold tabular-nums">{asset.price}</p>
          <p className="text-sm text-muted-foreground">{asset.symbol} · Market data</p>
        </div>
        <div role="group" aria-label={`${RANGE_NAMES[range]} price history`} className="flex flex-col gap-3">
          <svg viewBox="0 0 100 80" preserveAspectRatio="none" className="h-36 w-full text-market-gain" aria-hidden="true">
            <polyline points={points(range)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <ToggleGroup aria-label="Chart range" variant="outline" size="sm" spacing={0} className="w-full"
            value={[range]} onValueChange={(next) => { if (isRange(next[0])) setRange(next[0]); }}>
            {RANGES.map((option) => <ToggleGroupItem key={option} value={option} aria-label={RANGE_NAMES[option]} className="flex-1">{option}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <Separator />
        <section aria-label="Stats" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Stats</h3>
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted-foreground">Market cap</dt><dd className="text-end tabular-nums">$2.41T</dd>
            <dt className="text-muted-foreground">24h volume</dt><dd className="text-end tabular-nums">$38.2B</dd>
          </dl>
        </section>
        <Separator />
        <section aria-label="Your holding" className="flex items-center justify-between">
          <div>
            <p className="font-medium">Your holding</p>
            {asset.id === "cbbtc" ? <p className="text-sm text-muted-foreground">0.01234 cbBTC</p>
              : <p className="text-sm text-muted-foreground">None yet</p>}
          </div>
          {asset.id === "cbbtc" ? <p className="font-medium tabular-nums">$1,510.30</p>
            : <span className="flex flex-col items-end gap-1" aria-busy="true"><Skeleton className="h-4 w-16" /><span className="sr-only">Loading holding</span></span>}
        </section>
        <div className="grid grid-cols-2 gap-2">
          <Button size="touch">Buy</Button>
          <Button size="touch" variant="outline" disabled={asset.id !== "cbbtc"}>Sell</Button>
        </div>
      </CardContent>
    </Card>
  </section>;
}

function InvestComposition() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<Asset["id"]>("cbbtc");
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  const needle = query.trim().toLowerCase();
  const results = ASSETS.filter((asset) => !needle || asset.name.toLowerCase().includes(needle) || asset.symbol.toLowerCase().includes(needle));
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = results.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const selected = ASSETS.find((asset) => asset.id === selectedId) ?? ASSETS[0];
  return <div className="flex h-svh bg-muted">
    <Rail />
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto" aria-labelledby="composition-invest-title">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
        <h1 id="composition-invest-title" className="text-xl font-semibold">Invest</h1>
        <div className="grid grid-cols-[minmax(0,1fr)_22rem] items-start gap-4">
          <div className="flex flex-col gap-4">
            <form role="search" className="flex items-center gap-2" onSubmit={(event) => event.preventDefault()}>
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <Input ref={inputRef} type="text" inputMode="search" aria-label="Search assets" placeholder="Search assets"
                aria-keyshortcuts="Meta+K" autoComplete="off" spellCheck={false} value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
              <KbdGroup aria-hidden="true"><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
            </form>
            <Alert>
              <AlertIcon><CircleAlertIcon /></AlertIcon>
              <AlertTitle>Some results couldn’t load.</AlertTitle>
            </Alert>
            <section aria-labelledby="composition-invest-results">
              <Card className="gap-2">
                <CardHeader>
                  <CardTitle><h2 id="composition-invest-results">{needle ? "Results" : "Trending"}</h2></CardTitle>
                  <CardAction><span className="text-sm text-muted-foreground" role="status" aria-live="polite">{results.length} results</span></CardAction>
                </CardHeader>
                <CardContent inset="list">
                  {visible.length > 0 ? <ul className="list-none p-0">
                    {visible.map((asset, index) => <li key={asset.id}>
                      {index > 0 ? <Separator /> : null}
                      <AssetRow asset={asset} selected={asset.id === selected.id} onOpen={() => setSelectedId(asset.id)} />
                    </li>)}
                    <li aria-busy="true">
                      <Separator />
                      <Item variant="flush">
                        <ItemMedia variant="avatar" aria-hidden="true"><Skeleton className="size-8 rounded-full" /></ItemMedia>
                        <ItemContent><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-16" /></ItemContent>
                        <ItemActions><Skeleton className="h-4 w-16" /><span className="sr-only">Loading more results</span></ItemActions>
                      </Item>
                    </li>
                  </ul> : <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No results</EmptyTitle>
                      <EmptyDescription>No assets found for “{query.trim()}”.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>}
                </CardContent>
              </Card>
            </section>
            <nav aria-label="Results pages" className="flex items-center justify-between">
              <p className="text-sm">Page {current + 1} of {pages}</p>
              <ButtonGroup aria-label="Pager">
                <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  <ChevronLeft data-icon="inline-start" aria-hidden="true" />Previous
                </Button>
                <Button variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  Next<ChevronRight data-icon="inline-end" aria-hidden="true" />
                </Button>
              </ButtonGroup>
            </nav>
          </div>
          <AssetDetail key={selected.id} asset={selected} />
        </div>
      </div>
    </main>
  </div>;
}

const meta = {
  title: "Compositions/Invest",
  component: InvestComposition,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 5 },
    viewport: { viewports: { desktop1280: { name: "1280 × 800", styles: { width: "1280px", height: "800px" } } }, defaultViewport: "desktop1280" },
    a11y: { test: "error" },
  },
} satisfies Meta<typeof InvestComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Invest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Search assets" });
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => expect(input).toHaveFocus());
    await expect(canvas.getByRole("group", { name: "1 week price history" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "1 year" }));
    await expect(canvas.getByRole("group", { name: "1 year price history" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Next" }));
    await expect(canvas.getByText("Page 2 of 2")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Previous" }));
    await userEvent.type(input, "orb");
    await expect(canvas.getByText("Page 1 of 1")).toBeVisible();
    const rows = canvas.getAllByRole("button", { name: /Orbit/ });
    await expect(rows).toHaveLength(2);
    const [first] = rows;
    if (!first) throw new Error("missing Orbit row");
    await userEvent.click(first);
    await expect(canvas.getByRole("heading", { name: "Orbit", level: 2 })).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, "nothing-found");
    await expect(canvas.getByText("No results")).toBeVisible();
    await userEvent.clear(input);
    await userEvent.click(canvas.getByRole("button", { name: /^Bitcoin/ }));
    await userEvent.click(canvas.getByRole("button", { name: "1 week" }));
    await expect(canvas.getByRole("group", { name: "1 week price history" })).toBeVisible();
    input.blur();
  },
};
