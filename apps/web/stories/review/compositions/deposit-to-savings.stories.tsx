import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useId, useState, type ReactNode } from "react";
import { PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ResultHeader } from "@/components/ui/result-header";
import { StatusStep, StatusSteps } from "@/components/ui/status-step";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const AVAILABLE = 250;
const PRESETS = ["10", "25", "100"] as const;
const VAULT = "Spark USDC Vault";

function dollars(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function SavePage({ children }: { children: ReactNode }) {
  return <div className="flex h-svh flex-col bg-muted">
    <header className="shrink-0 border-b bg-background px-4 py-4 font-semibold">Save</header>
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4" aria-label="Save">
      <div className="flex flex-col gap-1 rounded-xl bg-background p-4">
        <p className="text-sm text-muted-foreground">Saved</p>
        <p className="text-4xl font-semibold tabular-nums">$1,111.11</p>
        <p className="flex items-center gap-1 text-sm text-muted-foreground"><PiggyBank aria-hidden="true" className="size-4" />{VAULT} · 4.10%</p>
      </div>
      {children}
    </main>
  </div>;
}

function DepositSheet() {
  const amountId = useId();
  const hintId = useId();
  const [amount, setAmount] = useState("25");
  const value = Number.parseFloat(amount);
  const valid = Number.isFinite(value) && value > 0;
  const over = valid && value > AVAILABLE;
  const preset = PRESETS.find((option) => Number.parseFloat(option) === value);
  return <SavePage>
    <Drawer defaultOpen>
      <DrawerTrigger render={<Button size="touch">Deposit</Button>} />
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Deposit</DrawerTitle>
          <DrawerDescription>To {VAULT} · 4.10%</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-5 px-4 pt-2 pb-2">
          <Progress label="Choose amount" value={1} max={3} />
          <Field data-invalid={over || undefined}>
            <Label htmlFor={amountId}>Amount</Label>
            <InputGroup>
              <InputGroupAddon><InputGroupText>$</InputGroupText></InputGroupAddon>
              <InputGroupInput id={amountId} inputMode="decimal" placeholder="0.00" value={amount}
                aria-invalid={over || undefined} aria-describedby={hintId}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} />
              <InputGroupAddon align="inline-end">
                <InputGroupButton onClick={() => setAmount(String(AVAILABLE))}>Max</InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {over ? <FieldError id={hintId}>You have {dollars(AVAILABLE)} USDC available.</FieldError>
              : <FieldDescription id={hintId}>{dollars(AVAILABLE)} USDC available</FieldDescription>}
          </Field>
          <ToggleGroup aria-label="Quick amounts" variant="outline" spacing={0} className="h-11 w-full"
            value={preset ? [preset] : []} onValueChange={(next) => { if (next[0]) setAmount(next[0]); }}>
            {PRESETS.map((option) => <ToggleGroupItem key={option} value={option} className="h-full flex-1">
              ${option}
            </ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <DrawerFooter>
          <Button size="touch" disabled={!valid || over}>{valid && !over ? `Deposit ${dollars(value)}` : "Deposit"}</Button>
          <DrawerClose render={<Button size="touch" variant="outline">Cancel</Button>} />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  </SavePage>;
}

function SubmittedSheet() {
  return <SavePage>
    <Drawer defaultOpen>
      <DrawerTrigger render={<Button size="touch">View deposit</Button>} />
      <DrawerContent>
        <DrawerHeader className="sr-only">
          <DrawerTitle>Deposit</DrawerTitle>
          <DrawerDescription>$25.00 to {VAULT}</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-6 px-4 pt-6 pb-2">
          <ResultHeader outcome="pending" title="Depositing $25.00 to Save" description="This usually takes a few seconds." />
          <Progress label="Confirming" value={2} max={3} />
          <StatusSteps>
            <StatusStep status="complete" title="Submitted" time="10:35 AM" />
            <StatusStep status="current" title="Confirming on Base" />
            <StatusStep status="upcoming" title="Earning in Save" />
          </StatusSteps>
          <StatusSteps>
            <StatusStep status="failed" title="Earlier deposit didn't go through" time="10:31 AM" showConnector={false} />
          </StatusSteps>
        </div>
        <DrawerFooter>
          <DrawerClose render={<Button size="touch">Done</Button>} />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  </SavePage>;
}

const meta = {
  title: "Compositions/Deposit to Savings",
  component: DepositSheet,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 2 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    a11y: { test: "error" },
  },
} satisfies Meta<typeof DepositSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DepositToSavings: Story = { name: "Deposit to Savings" };
export const DepositSubmitted: Story = { name: "Deposit Submitted", render: () => <SubmittedSheet /> };
