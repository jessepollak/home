"use client";

import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { CopyableValue } from "@/components/copyable-value";
import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { SupportMessageBubble } from "@/components/ui/support-message";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { brandCopyName } from "@/shared/operator-branding/theme";
import { BRAND_DEFAULTS } from "@/shared/operator-branding/schema";
import { DemoFrame } from "./demo-frame";
import { useStoryboard } from "./use-storyboard";

const supportHolds = [1400, 1200, 800] as const;
const growthHolds = [1200, 1100] as const;
const referralHolds = [1300, 160, 1600] as const;

const operatorLabel = "Operator 0x1111…1111";
const operatorReply = "I'll check this for you";

function OperatorChrome({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl bg-background text-foreground shadow-raised">
      <div className="flex h-14 items-center justify-between border-b ps-4 pe-2">
        <span className="text-base font-semibold">{brandCopyName(BRAND_DEFAULTS.displayName)}</span>
        <Button variant="ghost" size="icon-lg" className="size-11">
          <Menu aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-4 p-4">
        <p className="text-xl font-semibold tracking-tight">{heading}</p>
        {children}
      </div>
    </div>
  );
}

function Swap({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className={cn("col-start-1 row-start-1 transition-[opacity,translate] duration-base ease-standard", !show && "translate-y-1 opacity-0")}>
      {children}
    </div>
  );
}

export function ManagementDemo() {
  const board = useStoryboard(supportHolds);
  const typed = board.step === 1 || board.step === 2;
  const sending = board.step === 2;
  const replied = board.step === 3;
  return (
    <DemoFrame {...board} label="Support inbox">
      <OperatorChrome heading="Support">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-base font-semibold">0x2211…d77DA9</p>
          <Button variant="outline" size="touch">Resolve</Button>
        </div>
        <div className="grid">
          <Swap show={!replied}>
            <Item variant="outline" size="sm" className="h-full">
              <ItemContent><ItemTitle truncate="wrap">Assistant is handling this</ItemTitle></ItemContent>
              <ItemActions><Button variant="outline" size="touch">Take over</Button></ItemActions>
            </Item>
          </Swap>
          <Swap show={replied}>
            <Item variant="outline" size="sm" className="h-full">
              <ItemContent><ItemTitle truncate="wrap">An operator is handling this</ItemTitle></ItemContent>
              <ItemActions><Button variant="outline" size="touch">Hand back to assistant</Button></ItemActions>
            </Item>
          </Swap>
        </div>
        <div className="grid content-start gap-3 py-1">
          <div className="grid">
            <span className="text-xs text-muted-foreground">Customer</span>
            <SupportMessageBubble author="customer" side="operator">My funding order needs help</SupportMessageBubble>
          </div>
          <SupportMessageBubble author="assistant" side="operator">Your deposit is pending with the provider. It usually settles within an hour.</SupportMessageBubble>
          <div className={cn("grid transition-[opacity,translate] duration-(--motion-duration-slow) ease-(--motion-ease-emphasized)", !replied && "translate-y-2 opacity-0")}>
            <span className="ms-auto text-xs text-muted-foreground">{operatorLabel}</span>
            <SupportMessageBubble author="operator" side="operator" speaker={operatorLabel}>{operatorReply}</SupportMessageBubble>
          </div>
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-medium">Reply</p>
          <Textarea readOnly tabIndex={-1} value={typed ? operatorReply : ""} className="min-h-11" />
          <Button size="touch" loading={sending} disabled={!typed}>Send</Button>
        </div>
      </OperatorChrome>
    </DemoFrame>
  );
}

function GrowthCount({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums">
        <MoneyTicker value={value} align="start" reserveDigits={false} />
      </CardContent>
    </Card>
  );
}

export function GrowthDemo() {
  const board = useStoryboard(growthHolds);
  return (
    <DemoFrame {...board} label="Growth">
      <OperatorChrome heading="Growth">
        <div className="grid gap-3">
          <GrowthCount title="Invite links" value={board.step >= 1 ? "24" : "23"} />
          <GrowthCount title="Attributed sign-ups" value={board.step === 2 ? "8" : "7"} />
        </div>
      </OperatorChrome>
    </DemoFrame>
  );
}

const inviteUrl = "https://app.example.com/invite/k7m2p9xq4r";

export function ReferralDemo() {
  const board = useStoryboard(referralHolds);
  const pressed = board.step === 1;
  const copied = board.step === 2;
  return (
    <DemoFrame {...board} label="Invite friends">
      <div className="flex flex-col gap-3">
        <p className="text-lg font-semibold">Invite friends</p>
        <Card>
          <CardContent inset="list">
            <Item className="min-w-0 flex-wrap">
              <ItemContent className="min-w-0 flex-1">
                <div dir="ltr">
                  <CopyableValue
                    value={inviteUrl}
                    display={copied ? "Copied" : inviteUrl.replace(/^https?:\/\//, "")}
                    presentation="compact"
                    valueKind="invite link"
                    className={cn("transition-[background-color,scale] duration-fast ease-standard", pressed && "scale-[0.98] bg-state-pressed", copied && "text-primary")}
                  />
                </div>
              </ItemContent>
              <ItemActions className="flex-wrap">
                <Button variant="outline" size="touch">Share</Button>
              </ItemActions>
            </Item>
          </CardContent>
        </Card>
      </div>
    </DemoFrame>
  );
}
