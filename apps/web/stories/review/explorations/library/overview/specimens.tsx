import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Activity, ArrowDownToLine, ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon, LayoutDashboard, PiggyBank, Percent, ArrowUpFromLine, LockOpen, Star } from "lucide-react";
import { AggregateSignals } from "@/components/ui/aggregate-signals";
import { Alert, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { CoverageStatusPreview } from "@/components/ui/coverage-status-preview";
import { CoverageTable, type CoverageTableRow } from "@/components/ui/coverage-table";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FeatureIntro } from "@/components/ui/feature-intro";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "@/components/ui/prompt-input";
import { PullToRefreshAction, PullToRefreshIndicator, usePullToRefresh } from "@/components/ui/pull-to-refresh";
import { RadioGroup, RadioGroupOption } from "@/components/ui/radio-group";
import { RailNav, RailNavItem } from "@/components/ui/rail-nav";
import { ResultHeader } from "@/components/ui/result-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusStep, StatusSteps } from "@/components/ui/status-step";
import { SupportMessageBubble } from "@/components/ui/support-message";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toaster, toast } from "@/components/ui/toast";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type Specimen = { span?: "wide" | "full" | "tall"; Render: ComponentType };

type Currency = { value: string; label: string };
const currencies: Currency[] = [
  { value: "usd", label: "US dollar" },
  { value: "eur", label: "Euro" },
  { value: "brl", label: "Brazilian real" },
];

type Coverage = { country: string; currency: string; asset: string; rail: string };
const coverage: Coverage[] = [
  { country: "United States", currency: "USD", asset: "USDC", rail: "ACH" },
  { country: "Brazil", currency: "BRL", asset: "BRZ", rail: "Pix" },
  { country: "Mexico", currency: "MXN", asset: "Not configured", rail: "SPEI" },
];
const coverageColumns: ColumnDef<Coverage>[] = [
  { accessorKey: "country", header: "Country" },
  { accessorKey: "currency", header: "Currency" },
  { accessorKey: "asset", header: "Asset" },
  { accessorKey: "rail", header: "Rail" },
];

const coverageRows: CoverageTableRow[] = [
  {
    countryCode: "US", countryName: "United States", flag: "🇺🇸", currencies: "USD", asset: "USDC", issuerName: "Circle",
    stablecoin: { candidate: { symbol: "USDC", issuer: "Circle", verification: "Verified" } },
    portfolio: { status: "priority", workstreams: [] },
    issuer: { status: "documented", rail: "ACH", audience: "US persons", evidence: null },
    home: { status: "live", provider: "Coinbase", asset: "USDC", paymentMethods: ["ACH"] },
    quote: null,
  },
  {
    countryCode: "BR", countryName: "Brazil", flag: "🇧🇷", currencies: "BRL", asset: "Not configured", issuerName: "Not configured",
    stablecoin: { candidate: null },
    portfolio: { status: "deferred", workstreams: [] },
    issuer: { status: "not-researched", rail: "Not recorded", audience: "Not researched", evidence: null },
    home: { status: "none", provider: null, asset: null, paymentMethods: [] },
    quote: null,
  },
];

function ButtonSpecimen() {
  return <div className="flex flex-wrap items-center justify-center gap-2">
    <Button>Deposit</Button>
    <Button variant="outline">Withdraw</Button>
  </div>;
}

function ButtonGroupSpecimen() {
  const [page, setPage] = useState(3);
  return <ButtonGroup aria-label="Statements">
    <Button variant="outline" size="touch" aria-label="Previous" disabled={page === 1}
      onClick={() => setPage((current) => current - 1)}><ChevronLeftIcon /></Button>
    <Button variant="outline" size="touch" className="tabular-nums">{page} of 12</Button>
    <Button variant="outline" size="touch" aria-label="Next" disabled={page === 12}
      onClick={() => setPage((current) => current + 1)}><ChevronRightIcon /></Button>
  </ButtonGroup>;
}

function DialogSpecimen() {
  return <Dialog>
    <DialogTrigger render={<Button variant="outline" />}>Keyboard shortcuts</DialogTrigger>
    <DialogContent showCloseButton>
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>Press ? anywhere to open this list.</DialogDescription>
      </DialogHeader>
    </DialogContent>
  </Dialog>;
}

function DrawerSpecimen() {
  return <Drawer>
    <DrawerTrigger render={<Button variant="outline">Review deposit</Button>} />
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>Review deposit</DrawerTitle>
        <DrawerDescription>$25.00 USDC on Base</DrawerDescription>
      </DrawerHeader>
      <DrawerFooter>
        <Button>Deposit $25.00</Button>
        <DrawerClose render={<Button variant="outline">Back</Button>} />
      </DrawerFooter>
    </DrawerContent>
  </Drawer>;
}

function FieldSpecimen() {
  const id = useId();
  return <Field className="w-64">
    <FieldLabel htmlFor={id}>Amount</FieldLabel>
    <Input id={id} inputMode="decimal" placeholder="0.00" />
    <FieldDescription>$1,111.11 available</FieldDescription>
  </Field>;
}

function InputGroupSpecimen() {
  const [amount, setAmount] = useState("");
  return <InputGroup className="w-64">
    <InputGroupAddon><InputGroupText>USDC</InputGroupText></InputGroupAddon>
    <InputGroupInput aria-label="Amount" inputMode="decimal" placeholder="0.00" value={amount}
      onChange={(event) => setAmount(event.target.value)} />
    <InputGroupAddon align="inline-end">
      <InputGroupButton onClick={() => setAmount("1111.11")}>Max</InputGroupButton>
    </InputGroupAddon>
  </InputGroup>;
}

function InputOTPSpecimen() {
  const id = useId();
  const [code, setCode] = useState("");
  return <div className="grid gap-2">
    <Label htmlFor={id}>Verification code</Label>
    <InputOTP id={id} value={code} onChange={setCode} maxLength={6} pattern={REGEXP_ONLY_DIGITS}>
      <InputOTPGroup>
        {Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} />)}
      </InputOTPGroup>
    </InputOTP>
  </div>;
}

function LabelSpecimen() {
  const id = useId();
  return <div className="grid w-56 gap-2">
    <Label htmlFor={id}>Recipient</Label>
    <Input id={id} placeholder="name.base.eth" />
  </div>;
}

function ProgressSpecimen() {
  const [step, setStep] = useState(1);
  return <div className="flex w-64 flex-col items-start gap-4">
    <Progress label="Identity check" value={step} max={3} />
    <Button size="sm" variant="outline" onClick={() => setStep((current) => current === 3 ? 1 : current + 1)}>
      {step === 3 ? "Start over" : "Next step"}
    </Button>
  </div>;
}

function PromptInputSpecimen() {
  const [text, setText] = useState("");
  return <PromptInput className="w-64" onSubmit={(event) => { event.preventDefault(); setText(""); }}>
    <PromptInputTextarea aria-label="Message" placeholder="Ask a question" value={text}
      onChange={(event) => setText(event.currentTarget.value)} />
    <PromptInputSubmit busy={false} disabled={!text.trim()} onStop={() => {}} />
  </PromptInput>;
}

function PullToRefreshSpecimen() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [refreshes, setRefreshes] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => setRefreshing(true);
  useEffect(() => {
    if (!refreshing) return;
    let cancelled = false;
    const settle = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setRefreshes((count) => count + 1);
      setRefreshing(false);
    };
    void settle();
    return () => { cancelled = true; };
  }, [refreshing]);
  const { phase, indicatorRef, actionRef } = usePullToRefresh({ scrollRef, contentRef, enabled: true, refreshing, onRefresh: refresh });
  return <div ref={scrollRef} aria-label="Activity" data-refresh-phase={phase} className="relative h-36 w-64 overflow-y-auto overscroll-contain rounded-lg bg-muted">
    <PullToRefreshAction label="Refresh activity" refreshing={refreshing} onRefresh={refresh} actionRef={actionRef} />
    <PullToRefreshIndicator phase={phase} indicatorRef={indicatorRef} />
    <div ref={contentRef}>
      <p className="px-4 py-3 text-sm text-muted-foreground" role="status">
        {refreshes ? `Refreshed ${refreshes === 1 ? "once" : `${refreshes} times`}` : "Pull down to refresh"}
      </p>
      {["Deposit · $25.00", "Sent · $12.50", "Interest · $0.42", "Deposit · $100.00"].map((row) =>
        <p key={row} className="border-t border-border px-4 py-3 text-sm tabular-nums">{row}</p>)}
    </div>
  </div>;
}

function RadioGroupSpecimen() {
  const titleId = useId();
  const [value, setValue] = useState("checking");
  return <div className="grid w-64 gap-3">
    <p id={titleId} className="text-sm font-medium">Pay with</p>
    <RadioGroup aria-labelledby={titleId} value={value} onValueChange={setValue}>
      <RadioGroupOption value="checking" label="Checking •••• 4821" />
      <RadioGroupOption value="savings" label="Savings •••• 1234" />
    </RadioGroup>
  </div>;
}

function RailNavSpecimen() {
  const [current, setCurrent] = useState("overview");
  return <RailNav aria-label="Admin" className="w-48">
    <RailNavItem href="#overview" label="Overview" icon={LayoutDashboard} current={current === "overview"}
      onClick={() => setCurrent("overview")} />
    <RailNavItem href="#activity" label="Activity" icon={Activity} current={current === "activity"}
      onClick={() => setCurrent("activity")} />
  </RailNav>;
}

function SwitchSpecimen() {
  const [checked, setChecked] = useState(true);
  return <div className="flex items-center gap-3">
    <Switch aria-label="Show small balances" checked={checked} onCheckedChange={setChecked} />
    <span className="text-sm" aria-hidden="true">Show small balances</span>
  </div>;
}

function ToastSpecimen() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown) toast.add({ type: "success", title: "Deposit confirmed", description: "25.00 USDC on Base" });
  }, [shown]);
  return <>
    <Button variant="outline" onClick={() => setShown((count) => count + 1)}>Show toast</Button>
    {shown > 0 && <Toaster />}
  </>;
}

function ToggleSpecimen() {
  const [pressed, setPressed] = useState(false);
  return <Toggle variant="outline" aria-label="Add to watchlist" pressed={pressed} onPressedChange={setPressed}>
    <Star aria-hidden="true" />
  </Toggle>;
}

function ToggleGroupSpecimen() {
  const [value, setValue] = useState(["1W"]);
  return <ToggleGroup value={value} onValueChange={setValue} aria-label="Price range" variant="outline" spacing={0} className="h-11 w-64">
    {["1D", "1W", "1M", "1Y"].map((range) =>
      <ToggleGroupItem key={range} value={range} className="h-full flex-1">{range}</ToggleGroupItem>)}
  </ToggleGroup>;
}

export const specimens: Record<string, Specimen> = {
  "ui-aggregate-signals": {
    Render: () => <div className="w-72">
      <AggregateSignals title="Token checks" source="GoPlus"
        summary={[{ id: "restriction", label: "Sell restriction reported", tone: "danger" }]}
        signals={[
          { id: "sell", label: "Sell limit", detail: "Holders may not be able to sell their full balance at once", tone: "danger" },
          { id: "unknown", label: "Unknown signals", detail: "No data: blocklist", tone: "neutral" },
        ]} />
    </div>,
  },
  "ui-alert": {
    Render: () => <Alert className="w-72">
      <AlertIcon><CircleAlertIcon /></AlertIcon>
      <AlertTitle>Saved balance unavailable</AlertTitle>
      <AlertDescription>Retry to load the latest snapshot.</AlertDescription>
    </Alert>,
  },
  "ui-badge": {
    Render: () => <div className="flex flex-wrap items-center justify-center gap-2">
      <Badge>Earning</Badge>
      <Badge variant="warning">Rate stale</Badge>
    </div>,
  },
  "ui-button": { Render: ButtonSpecimen },
  "ui-button-group": { Render: ButtonGroupSpecimen },
  "ui-card": {
    Render: () => <Card className="w-64" size="sm">
      <CardHeader>
        <CardTitle>Save</CardTitle>
        <CardDescription>USDC vault · 3.85%</CardDescription>
        <CardAction><Button variant="ghost" size="sm">Details</Button></CardAction>
      </CardHeader>
      <CardContent><p className="text-lg font-semibold tabular-nums">$1,111.11</p></CardContent>
      <CardFooter><Button className="w-full">Deposit</Button></CardFooter>
    </Card>,
  },
  "ui-combobox": {
    Render: () => <Combobox items={currencies} defaultValue={currencies[0]} aria-label="Currency">
      <ComboboxInput aria-label="Currency" triggerLabel="Show currencies" placeholder="Search currencies" className="w-60" />
      <ComboboxContent>
        <ComboboxEmpty>No currencies found.</ComboboxEmpty>
        <ComboboxList>
          {(option: Currency) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>,
  },
  "ui-coverage-status-preview": {
    Render: () => <div className="flex items-center gap-6 text-sm">
      <span className="flex items-center gap-1">
        <CoverageStatusPreview status="Green" accessibleName="Green — United States live"
          heading="United States" details={[{ label: "Status", value: "Live" }, { label: "Asset", value: "USDC" }]} />
        United States
      </span>
      <span className="flex items-center gap-1">
        <CoverageStatusPreview status="Yellow" accessibleName="Yellow — Brazil candidate identified"
          heading="Brazil stablecoin candidate" details={[{ label: "Status", value: "Identified" }, { label: "Asset", value: "BRZ" }]} />
        Brazil
      </span>
    </div>,
  },
  "ui-coverage-table": { span: "full", Render: () => <div className="w-full overflow-x-auto"><CoverageTable rows={coverageRows} /></div> },
  "ui-data-table": {
    span: "full",
    Render: () => <div className="w-full overflow-x-auto">
      <DataTable columns={coverageColumns} data={coverage} caption="Funding coverage" density="compact" />
    </div>,
  },
  "ui-dialog": { Render: DialogSpecimen },
  "ui-drawer": { Render: DrawerSpecimen },
  "ui-empty": {
    Render: () => <Empty className="w-72 p-0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><ArrowDownToLine aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>Nothing saved yet</EmptyTitle>
        <EmptyDescription>Deposit USDC to start earning.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button size="sm">Get started</Button></EmptyContent>
    </Empty>,
  },
  "ui-feature-intro": {
    span: "tall",
    Render: () => <div className="w-72">
      <FeatureIntro size="compact" headline="Start saving" illustration="savings" primary={{ label: "Get started", onClick: () => {} }}
        benefits={[
          { icon: Percent, text: "Earn interest on USDC" },
          { icon: ArrowUpFromLine, text: "Withdraw anytime" },
          { icon: LockOpen, text: "No lockups" },
        ]} />
    </div>,
  },
  "ui-field": { Render: FieldSpecimen },
  "ui-input": { Render: () => <Input className="w-56" aria-label="Amount" inputMode="decimal" placeholder="0.00" /> },
  "ui-input-group": { Render: InputGroupSpecimen },
  "ui-input-otp": { Render: InputOTPSpecimen },
  "ui-item": {
    Render: () => <Item variant="outline" className="w-72">
      <ItemMedia variant="icon" aria-hidden="true"><PiggyBank /></ItemMedia>
      <ItemContent>
        <ItemTitle>Steakhouse USDC</ItemTitle>
        <ItemDescription>3.85%</ItemDescription>
      </ItemContent>
      <ItemActions><ItemTitle numeric>$123.46</ItemTitle></ItemActions>
    </Item>,
  },
  "ui-kbd": {
    Render: () => <div className="flex items-center gap-4">
      <KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
      <Kbd>Esc</Kbd>
    </div>,
  },
  "ui-label": { Render: LabelSpecimen },
  "ui-popover": {
    Render: () => <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>Balance details</PopoverTrigger>
      <PopoverContent aria-label="Balance details">
        <PopoverDescription>Some balances are unavailable.</PopoverDescription>
      </PopoverContent>
    </Popover>,
  },
  "ui-progress": { Render: ProgressSpecimen },
  "ui-prompt-input": { Render: PromptInputSpecimen },
  "ui-pull-to-refresh": { Render: PullToRefreshSpecimen },
  "ui-radio-group": { Render: RadioGroupSpecimen },
  "ui-rail-nav": { Render: RailNavSpecimen },
  "ui-result-header": { Render: () => <ResultHeader outcome="success" title="$25.00 sent" /> },
  "ui-select": {
    Render: () => <Select defaultValue="usdc" items={[{ value: "usdc", label: "USDC" }, { value: "eurc", label: "EURC" }]}>
      <SelectTrigger aria-label="Asset" className="w-44"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="usdc">USDC</SelectItem>
        <SelectItem value="eurc">EURC</SelectItem>
      </SelectContent>
    </Select>,
  },
  "ui-separator": {
    Render: () => <div className="flex w-56 flex-col gap-3 text-sm">
      <p className="flex justify-between"><span>Balance</span><span className="tabular-nums">$1,111.11</span></p>
      <Separator />
      <p className="flex justify-between"><span>Earning</span><span className="tabular-nums">3.85%</span></p>
    </div>,
  },
  "ui-skeleton": {
    Render: () => <div className="flex w-56 flex-col gap-2">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-4 w-40" />
    </div>,
  },
  "ui-status-step": {
    Render: () => <div className="w-64">
      <StatusSteps>
        <StatusStep status="complete" title="Submitted" time="10:35 AM" />
        <StatusStep status="current" title="Confirming on Base" />
      </StatusSteps>
    </div>,
  },
  "ui-support-message": {
    Render: () => <div className="grid w-64 gap-3">
      <SupportMessageBubble author="customer" side="customer">Where is my deposit?</SupportMessageBubble>
      <SupportMessageBubble author="operator" side="customer">Let me check for you.</SupportMessageBubble>
    </div>,
  },
  "ui-switch": { Render: SwitchSpecimen },
  "ui-table": {
    span: "wide",
    Render: () => <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Vault</TableHead>
          <TableHead scope="col">Rate</TableHead>
          <TableHead scope="col">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[["Steakhouse USDC", "3.85%", "$123.46"], ["Gauntlet USDC Prime", "4.10%", "$987.65"]].map(([vault, rate, balance]) =>
          <TableRow key={vault}>
            <TableHead scope="row">{vault}</TableHead>
            <TableCell className="tabular-nums">{rate}</TableCell>
            <TableCell className="tabular-nums">{balance}</TableCell>
          </TableRow>)}
      </TableBody>
    </Table>,
  },
  "ui-toast": { Render: ToastSpecimen },
  "ui-toggle": { Render: ToggleSpecimen },
  "ui-toggle-group": { Render: ToggleGroupSpecimen },
};
