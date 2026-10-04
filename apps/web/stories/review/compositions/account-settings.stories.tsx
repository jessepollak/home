import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useId, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "@/components/ui/prompt-input";
import { SupportMessageBubble } from "@/components/ui/support-message";
import { RadioGroup, RadioGroupSegment } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "BR", label: "Brazil" },
  { value: "MX", label: "Mexico" },
  { value: "AR", label: "Argentina" },
  { value: "NG", label: "Nigeria" },
] as const;

const APPEARANCES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

type Appearance = (typeof APPEARANCES)[number]["value"];
type InviteState = "error" | "loading" | "loaded";

const ADDRESS = "0x1111…1111";
const INVITE = "home.base.org/i/abcdefghjk";

function isAppearance(value: unknown): value is Appearance {
  return APPEARANCES.some((option) => option.value === value);
}

function isCountry(value: unknown): value is (typeof COUNTRIES)[number]["value"] {
  return COUNTRIES.some((option) => option.value === value);
}

function SupportConversation() {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<{ id: string; text: string }[]>([]);
  return <div className="grid gap-4">
    <SupportMessageBubble author="operator" side="customer">How can we help?</SupportMessageBubble>
    {messages.map((message) => <SupportMessageBubble key={message.id} author="customer" side="customer">{message.text}</SupportMessageBubble>)}
    <PromptInput onSubmit={(event) => {
      event.preventDefault();
      if (!text.trim()) return;
      setMessages((current) => [...current, { id: crypto.randomUUID(), text }]);
      setText("");
    }}>
      <PromptInputTextarea aria-label="Message support" placeholder="Ask a question" value={text}
        onChange={(event) => setText(event.currentTarget.value)} />
      <PromptInputSubmit busy={false} disabled={!text.trim()} onStop={() => {}} />
    </PromptInput>
  </div>;
}

function AccountSettingsComposition({ signOutOpen = false }: { signOutOpen?: boolean }) {
  const countryId = useId();
  const smallBalancesId = useId();
  const appearanceId = useId();
  const [country, setCountry] = useState<string>("US");
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [showSmallBalances, setShowSmallBalances] = useState(false);
  const [invite, setInvite] = useState<InviteState>("error");
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    if (invite !== "loading") return;
    let live = true;
    void Promise.resolve().then(() => { if (live) setInvite("loaded"); });
    return () => { live = false; };
  }, [invite]);
  const countryLabel = COUNTRIES.find((option) => option.value === country)?.label ?? "United States";
  if (signedOut) return <div className="flex h-svh flex-col bg-muted">
    <header className="shrink-0 border-b bg-background px-4 py-4 font-semibold">Home</header>
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4" aria-label="Signed out">
      <p className="text-lg font-semibold">Signed out</p>
      <Button size="touch" onClick={() => setSignedOut(false)}>Sign in</Button>
    </main>
  </div>;
  return <div className="flex h-svh flex-col bg-muted">
    <header className="shrink-0 border-b bg-background px-4 py-4 font-semibold">Account</header>
    <main className="min-h-0 flex-1 overflow-y-auto" aria-label="Account settings">
      <div className="mx-auto flex w-full max-w-160 flex-col gap-8 px-4 py-4 pb-6">
        <section className="flex flex-col gap-3" aria-labelledby="composition-account-preferences">
          <h2 id="composition-account-preferences" className="text-lg font-semibold">Preferences</h2>
          <Card>
            <CardContent inset="list">
              <Item className="min-w-0 flex-nowrap items-center">
                <ItemContent className="min-w-0 flex-1">
                  <ItemTitle><Label htmlFor={countryId}>Country</Label></ItemTitle>
                  <ItemDescription>Sets how money is shown in {countryLabel}</ItemDescription>
                </ItemContent>
                <ItemActions className="min-w-0 shrink justify-end">
                  <Select items={COUNTRIES} value={country} onValueChange={(next) => { if (isCountry(next)) setCountry(next); }}>
                    <SelectTrigger id={countryId} className="h-11 max-w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </ItemActions>
              </Item>
              <Separator />
              <Item className="min-w-0 flex-wrap items-center">
                <ItemContent className="min-w-0 flex-1">
                  <ItemTitle id={appearanceId}>Appearance</ItemTitle>
                </ItemContent>
                <ItemActions className="w-full min-w-0 basis-full">
                  <RadioGroup variant="segmented" aria-labelledby={appearanceId} value={appearance}
                    onValueChange={(next) => { if (isAppearance(next)) setAppearance(next); }}>
                    {APPEARANCES.map((option) => <RadioGroupSegment key={option.value} value={option.value}>{option.label}</RadioGroupSegment>)}
                  </RadioGroup>
                </ItemActions>
              </Item>
              <Separator />
              <Item className="min-w-0 flex-nowrap items-center">
                <ItemContent className="min-w-0 flex-1">
                  <ItemTitle><Label htmlFor={smallBalancesId}>Show small balances</Label></ItemTitle>
                  <ItemDescription>{showSmallBalances ? "Showing balances under $1" : "Hiding balances under $1"}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch id={smallBalancesId} checked={showSmallBalances} onCheckedChange={setShowSmallBalances} />
                </ItemActions>
              </Item>
            </CardContent>
          </Card>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="composition-account-account">
          <h2 id="composition-account-account" className="text-lg font-semibold">Account</h2>
          <Card>
            <CardContent inset="list">
              <ul className="m-0 list-none p-0">
                <li className="min-w-0">
                  <Item className="min-w-0">
                    <ItemContent className="min-w-0">
                      <ItemTitle>jesse.base.eth</ItemTitle>
                      <ItemDescription lines={1}>{ADDRESS}</ItemDescription>
                    </ItemContent>
                  </Item>
                </li>
                <li className="px-3 py-2.5">
                  <Dialog defaultOpen={signOutOpen}>
                    <DialogTrigger render={<Button variant="outline" size="touch" className="w-full justify-start" />}>
                      <LogOut aria-hidden="true" />
                      Sign out
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Sign out of Home?</DialogTitle>
                        <DialogDescription>Sign back in any time with your Base Account.</DialogDescription>
                      </DialogHeader>
                      <div className="grid grid-cols-2 gap-2">
                        <DialogClose render={<Button variant="outline" size="touch" />}>Cancel</DialogClose>
                        <Button size="touch" onClick={() => setSignedOut(true)}>Sign out</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="composition-account-invites">
          <h2 id="composition-account-invites" className="text-lg font-semibold">Invite friends</h2>
          <Card>
            <CardContent inset="list">
              <Item className="min-w-0 flex-wrap" aria-busy={invite === "loading" || undefined}>
                <ItemContent className="min-w-0">
                  {invite === "loading" ? <>
                    <Skeleton className="h-5 w-full" />
                    <span role="status" className="sr-only">Loading invite link</span>
                  </> : invite === "error" ? <>
                    <ItemDescription>Couldn&apos;t load your invite link.</ItemDescription>
                    <ItemActions>
                      <Button variant="outline" size="touch" onClick={() => setInvite("loading")}>Try again</Button>
                    </ItemActions>
                  </> : <ItemTitle>{INVITE}</ItemTitle>}
                </ItemContent>
              </Item>
            </CardContent>
          </Card>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="composition-account-support">
          <h2 id="composition-account-support" className="text-lg font-semibold">Support</h2>
          <Card><CardContent><SupportConversation /></CardContent></Card>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="composition-account-disclosures">
          <h2 id="composition-account-disclosures" className="text-lg font-semibold">Disclosures &amp; terms</h2>
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Features and providers vary by country. <a className="font-medium text-primary" href="#ripio-terms">Ripio terms</a> · <a className="font-medium text-primary" href="#morpho-terms">Morpho terms</a>
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  </div>;
}

const meta = {
  title: "Compositions/Account settings",
  component: AccountSettingsComposition,
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 7 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    a11y: { test: "error" },
  },
} satisfies Meta<typeof AccountSettingsComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AccountSettings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const appearance = canvas.getByRole("radiogroup", { name: "Appearance" });
    for (const label of ["Dark", "System"]) {
      await userEvent.click(within(appearance).getByRole("radio", { name: label }));
      await expect(within(appearance).getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
    }
    const smallBalances = canvas.getByRole("switch", { name: "Show small balances" });
    await userEvent.click(smallBalances);
    await expect(smallBalances).toHaveAttribute("aria-checked", "true");
    await userEvent.click(smallBalances);
    await expect(smallBalances).toHaveAttribute("aria-checked", "false");
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeVisible();
    const support = canvas.getByRole("region", { name: "Support" });
    await expect(within(support).getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(within(support).getByRole("textbox", { name: "Message support" }), "Where is my deposit?");
    await userEvent.click(within(support).getByRole("button", { name: "Send" }));
    await expect(within(support).getByText("Where is my deposit?")).toBeVisible();
    await expect(within(support).getByRole("textbox", { name: "Message support" })).toHaveValue("");
  },
};

export const AccountSignOut: Story = {
  name: "Account Sign Out",
  args: { signOutOpen: true },
  parameters: { a11y: { test: "error", context: { include: ["body"], exclude: ["[data-base-ui-focus-guard]"] } } },
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Sign out of Home?" });
    await expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: "Sign out" })).toBeEnabled();
  },
};
