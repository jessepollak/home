import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useId, useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupOption } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster, toast } from "@/components/ui/toast";

type Recipient = { id: string; name: string | null; address: string };

const AVAILABLE = 25;
const EDITS = new Set<string>(["input-change", "clear-press"]);
const RECENT: Recipient[] = [
  { id: "jesse", name: "jesse.base.eth", address: "0x2211…d77DA9" },
  { id: "other", name: null, address: "0x2222…222222" },
];
const NAMES: Record<string, string> = { "jesse.base.eth": "0x2211…d77DA9", "example.base.eth": "0x2211…d77DA9" };

function recipientLabel(recipient: Recipient): string {
  return recipient.name ?? recipient.address;
}

function dollars(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function recipientStatus(value: string): { tone: "hint" | "resolved" | "error"; text: string; address: string | null } | null {
  const entry = value.trim().toLowerCase();
  if (!entry) return null;
  if (/^0x[0-9a-f]{40}$/.test(entry)) return { tone: "hint", text: "", address: `${value.slice(0, 6)}…${value.slice(-6)}` };
  const recent = RECENT.find((recipient) => recipient.address.toLowerCase() === entry);
  if (recent) return { tone: "hint", text: "", address: recent.address };
  if (entry.endsWith(".eth")) {
    const resolved = NAMES[entry];
    return resolved ? { tone: "resolved", text: `Resolves to ${resolved}`, address: resolved }
      : { tone: "error", text: `We couldn't resolve ${entry}. Check the name and try again.`, address: null };
  }
  return { tone: "hint", text: "Enter a 0x address or a name like example.base.eth.", address: null };
}

function ReviewRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="flex min-h-11 items-center justify-between gap-4 py-2">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="flex min-w-0 flex-col items-end text-right">
      <span className="truncate font-medium">{value}</span>
      {detail ? <span className="text-xs text-muted-foreground tabular-nums">{detail}</span> : null}
    </dd>
  </div>;
}

function VerifyStep({ onVerified, onBack }: { onVerified: () => void; onBack: () => void }) {
  const codeId = useId();
  const [code, setCode] = useState("");
  return <>
    <DialogHeader>
      <DialogTitle className="text-base">Verify it&apos;s you</DialogTitle>
      <DialogDescription>Enter the code we sent to j•••@example.com.</DialogDescription>
    </DialogHeader>
    <Field>
      <FieldLabel htmlFor={codeId}>Verification code</FieldLabel>
      <InputOTP id={codeId} value={code} onChange={setCode} maxLength={6} pattern={REGEXP_ONLY_DIGITS}
        autoComplete="one-time-code" inputMode="numeric">
        <InputOTPGroup>
          {Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} />)}
        </InputOTPGroup>
      </InputOTP>
      <Button variant="ghost" size="sm-touch" className="self-start">Resend code</Button>
    </Field>
    <div className="grid gap-2">
      <Button size="touch" disabled={code.length < 6} onClick={onVerified}>Confirm</Button>
      <Button size="touch" variant="outline" onClick={onBack}>Back</Button>
    </div>
  </>;
}

function ReviewStep({ amount, recipient, onSend }: { amount: number; recipient: Recipient; onSend: () => void }) {
  return <>
    <DialogHeader>
      <DialogTitle className="text-base">Confirm</DialogTitle>
      <DialogDescription>You&apos;re sending USDC</DialogDescription>
    </DialogHeader>
    <p className="text-4xl font-semibold tabular-nums">{dollars(amount)}</p>
    <dl className="flex flex-col divide-y">
      <ReviewRow label="From" value="Your account" detail="0x1111…111111" />
      <ReviewRow label="To" value={recipientLabel(recipient)} detail={recipient.name ? recipient.address : undefined} />
      <ReviewRow label="Asset" value="USDC" />
      <ReviewRow label="Network" value="Base" />
      <ReviewRow label="Network fee" value="Less than $0.01" />
    </dl>
    <div className="grid gap-2">
      <Button size="touch" onClick={onSend}>Send {dollars(amount)}</Button>
      <DialogClose render={<Button size="touch" variant="outline">Back</Button>} />
    </div>
  </>;
}

function SendComposition({ initial = "form" }: { initial?: "form" | "review" | "verify" }) {
  const review = initial !== "form";
  const amountId = useId();
  const amountHintId = useId();
  const recipientId = useId();
  const recipientStatusId = useId();
  const [amount, setAmount] = useState(review ? "25" : "");
  const [asset, setAsset] = useState("usdc");
  const [selected, setSelected] = useState<Recipient | null>(review ? RECENT[0] ?? null : null);
  const [query, setQuery] = useState(review ? "jesse.base.eth" : "");
  const [open, setOpen] = useState(review);
  const [step, setStep] = useState<"review" | "verify">(initial === "verify" ? "verify" : "review");
  const value = Number.parseFloat(amount);
  const validAmount = Number.isFinite(value) && value > 0;
  const over = validAmount && value > AVAILABLE;
  const status = selected && recipientLabel(selected) === query ? null : recipientStatus(query);
  const recipient: Recipient | null = selected && recipientLabel(selected) === query ? selected
    : status?.address ? { id: "typed", name: status.tone === "resolved" ? query.trim().toLowerCase() : null, address: status.address } : null;
  const ready = validAmount && !over && recipient !== null;
  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) setStep("review");
  };
  const verified = () => {
    openChange(false);
    toast.add({ type: "success", title: "Sent", description: `${dollars(value)} to ${recipient ? recipientLabel(recipient) : "recipient"}` });
    setAmount("");
    setSelected(null);
    setQuery("");
  };
  return <div className="flex h-svh flex-col bg-background">
    <header className="shrink-0 border-b px-4 py-4 font-semibold">Send</header>
    <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-5" aria-label="Send">
      <Field data-invalid={over || undefined}>
        <FieldLabel htmlFor={amountId}>Amount</FieldLabel>
        <Input id={amountId} variant="touch" className="h-11" inputMode="decimal" placeholder="$0.00" value={amount}
          aria-invalid={over || undefined} aria-describedby={amountHintId}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} />
        {over ? <FieldError id={amountHintId}>You have {dollars(AVAILABLE)} USDC available.</FieldError>
          : <FieldDescription id={amountHintId}>{dollars(AVAILABLE)} available</FieldDescription>}
      </Field>
      <FieldSet>
        <FieldLegend variant="label" id={`${amountId}-pay`}>Pay with</FieldLegend>
        <RadioGroup aria-labelledby={`${amountId}-pay`} value={asset} onValueChange={(next) => { if (typeof next === "string") setAsset(next); }}>
          <RadioGroupOption value="usdc" label="USDC" description="$25.00 available" />
          <RadioGroupOption value="eth" disabled label="ETH" description={<span aria-busy="true" className="flex items-center gap-2">
            <Skeleton className="h-4 w-20" /><span className="sr-only">Loading balance</span>
          </span>} />
          <RadioGroupOption value="eurc" disabled label="EURC" description="No balance to send" />
        </RadioGroup>
      </FieldSet>
      <div className="flex flex-col gap-2">
        <Label htmlFor={recipientId} id={`${recipientId}-label`}>To</Label>
        <Combobox<Recipient> items={RECENT} value={selected} inputValue={query} autoHighlight
          itemToStringLabel={recipientLabel}
          onValueChange={(next) => { setSelected(next); if (next) setQuery(recipientLabel(next)); }}
          onInputValueChange={(next, details) => { if (EDITS.has(details.reason)) setQuery(next); }}>
          <ComboboxInput id={recipientId} aria-labelledby={`${recipientId}-label`} showTrigger={false} className="h-11" placeholder="Address or name"
            aria-describedby={status?.text ? recipientStatusId : undefined} aria-invalid={status?.tone === "error" || undefined}
            autoComplete="off" autoCapitalize="none" spellCheck={false} />
          <ComboboxContent>
            <ComboboxEmpty>No recent recipients match.</ComboboxEmpty>
            <ComboboxList>
              {(item: Recipient) => <ComboboxItem key={item.id} value={item}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{recipientLabel(item)}</span>
                  {item.name ? <span className="text-xs text-muted-foreground">{item.address}</span> : null}
                </span>
              </ComboboxItem>}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {status?.text ? <p id={recipientStatusId} role={status.tone === "error" ? "alert" : undefined}
          className={status.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{status.text}</p> : null}
      </div>
      <FieldSeparator>Or</FieldSeparator>
      <div className="flex flex-col items-start gap-1">
        <p className="text-sm text-muted-foreground">Cash out is unavailable right now.</p>
        <Button variant="ghost" size="sm-touch">Try again</Button>
      </div>
    </main>
    <footer className="shrink-0 border-t px-4 py-3">
      <Button size="touch" className="w-full" disabled={!ready} onClick={() => setOpen(true)}>Continue</Button>
    </footer>
    <Dialog open={open} onOpenChange={openChange}>
      <DialogContent>
        {step === "review" && recipient ? <ReviewStep amount={value} recipient={recipient} onSend={() => setStep("verify")} /> : null}
        {step === "verify" ? <VerifyStep onVerified={verified} onBack={() => setStep("review")} /> : null}
      </DialogContent>
    </Dialog>
    <Toaster />
  </div>;
}

const meta = {
  title: "Compositions/Send",
  component: SendComposition,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 3 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    a11y: { test: "error" },
  },
} satisfies Meta<typeof SendComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Send: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Cash out is unavailable right now.")).toBeVisible();
    await expect(canvas.getByRole("radio", { name: "EURC" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.type(canvas.getByRole("textbox", { name: "Amount" }), "10");
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeDisabled();
  },
};

export const SendReview: Story = {
  name: "Send Review",
  args: { initial: "review" },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: "Confirm" });
    await expect(within(dialog).getByText("jesse.base.eth")).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: "Send $25.00" })).toBeVisible();
  },
};

export const SendVerify: Story = {
  name: "Send Verify",
  args: { initial: "verify" },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const verify = await body.findByRole("dialog", { name: "Verify it's you" });
    await userEvent.type(within(verify).getByRole("textbox", { name: "Verification code" }), "123456");
    await userEvent.click(within(verify).getByRole("button", { name: "Confirm" }));
    await expect(await body.findByText("Sent")).toBeVisible();
    await waitFor(() => expect(body.queryByRole("dialog", { name: "Verify it's you" })).not.toBeInTheDocument());
  },
};
