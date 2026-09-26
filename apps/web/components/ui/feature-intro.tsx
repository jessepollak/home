"use client";

import { useId } from "react";
import type { Ref } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerTitle } from "@/components/ui/drawer";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

type FeatureIntroBenefit = { icon: LucideIcon; text: string };
type FeatureIntroAction = {
  label: string;
  onClick: () => void;
  onPointerDown?: () => void;
  disabled?: boolean;
  pending?: boolean;
  ref?: Ref<HTMLButtonElement>;
};
type FeatureIntroAvailability =
  | { kind: "available" }
  | { kind: "unavailable"; reason: string; recovery?: { label: string; onClick: () => void } };
export type FeatureIntroContent = {
  headline: string;
  description?: string;
  benefits: [FeatureIntroBenefit, FeatureIntroBenefit] | [FeatureIntroBenefit, FeatureIntroBenefit, FeatureIntroBenefit] | [FeatureIntroBenefit, FeatureIntroBenefit, FeatureIntroBenefit, FeatureIntroBenefit];
  illustration?: "card" | "savings";
  primary: FeatureIntroAction;
  secondary?: { label: string; onClick: () => void };
  availability?: FeatureIntroAvailability;
};

function Sparkle({ x, y, arm }: { x: number; y: number; arm: number }) {
  return (
    <g stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
      <path d={`M${x - arm} ${y} H${x + arm} M${x} ${y - arm} V${y + arm}`} />
    </g>
  );
}

function LinePlaneIllustration({ subject }: { subject: "card" | "savings" }) {
  const clipId = useId();
  return (
    <svg viewBox="0 0 240 160" aria-hidden="true" focusable="false" className="block aspect-[3/2] w-full">
      {subject === "card" ? (
        <>
          <ellipse cx="124" cy="138" rx="52" ry="4" fill="var(--muted)" />
          <g transform="rotate(6 129 83)">
            <path d="M164 41 H186.8 A6.2 6.2 0 0 1 193 47.2 V118.8 A6.2 6.2 0 0 1 186.8 125 H71.2 A6.2 6.2 0 0 1 65 118.8" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <g transform="rotate(-8 111 69)">
            <rect x="47" y="27" width="128" height="84" rx="7.2" fill="var(--primary)" />
            <path d="M66 45 H84 A1 1 0 0 1 85 46 V59 A1 1 0 0 1 84 60 H66 A1 1 0 0 1 65 59 V46 A1 1 0 0 1 66 45 Z" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M155.24 48.76 A6 6 0 0 1 155.24 57.24" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M158.07 45.93 A10 10 0 0 1 158.07 60.07" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M160.9 43.1 A14 14 0 0 1 160.9 62.9" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <Sparkle x={194} y={28} arm={7} />
          <Sparkle x={44} y={136} arm={5} />
        </>
      ) : (
        <>
          <defs><clipPath id={clipId}><rect x="0" y="0" width="240" height="129" /></clipPath></defs>
          <g clipPath={`url(#${clipId})`}>
            <path d="M143 129 V63.4 A2.4 2.4 0 0 1 145.4 61 H170.6 A2.4 2.4 0 0 1 173 63.4 V129 Z" fill="var(--balance-savings)" />
          </g>
          <path d="M41 129 H196" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M68 129 V106.4 A1.4 1.4 0 0 1 69.4 105 H94.6 A1.4 1.4 0 0 1 96 106.4 V129" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M106 129 V86.4 A1.4 1.4 0 0 1 107.4 85 H132.6 A1.4 1.4 0 0 1 134 86.4 V129" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M60 97 Q110 45 178 35" fill="none" stroke="var(--balance-savings)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M178 35 L170.9 31.4 L178 35 L172.2 40.5" fill="none" stroke="var(--balance-savings)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <Sparkle x={194} y={47} arm={6} />
        </>
      )}
    </svg>
  );
}

function IntroActions({ primary, secondary, availability }: Pick<FeatureIntroContent, "primary" | "secondary" | "availability">) {
  const { ref, ...action } = primary;
  const reasonId = useId();
  if (availability?.kind === "unavailable") {
    return (
      <div className="w-full space-y-2">
        <p id={reasonId} className="text-center text-sm text-muted-foreground">{availability.reason}</p>
        {availability.recovery ? (
          <Button size="touch" className="w-full" aria-describedby={reasonId} onClick={availability.recovery.onClick}>
            {availability.recovery.label}
          </Button>
        ) : null}
        {secondary ? (
          <Button variant="ghost" size="touch" className="w-full" onClick={secondary.onClick}>{secondary.label}</Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="w-full space-y-2">
      <Button size="touch" className="w-full" disabled={action.disabled} loading={action.pending}
        onClick={action.onClick} onPointerDown={action.onPointerDown} ref={ref}>
        {action.label}
      </Button>
      {secondary ? <Button variant="ghost" size="touch" className="w-full" onClick={secondary.onClick}>{secondary.label}</Button> : null}
    </div>
  );
}

function IntroBody({ content, sheet = false, size = "default" }: { content: FeatureIntroContent; sheet?: boolean; size?: "default" | "compact" }) {
  return (
    <div className="space-y-5">
      {content.illustration ? (
        <div className={sheet ? "mx-auto w-full max-w-70" : size === "compact" ? "mx-auto w-full max-w-40" : "mx-auto w-full max-w-60"}>
          <LinePlaneIllustration subject={content.illustration} />
        </div>
      ) : null}
      <div className="space-y-2">
        {sheet ? <DrawerTitle className="text-center text-2xl leading-8 text-balance">{content.headline}</DrawerTitle> : <h2 className="text-center text-2xl font-semibold text-balance">{content.headline}</h2>}
        {content.description ? sheet ? <DrawerDescription className="text-center">{content.description}</DrawerDescription> : <p className="text-center text-sm text-muted-foreground">{content.description}</p> : null}
      </div>
      <ul className="space-y-1 rounded-lg border px-3 py-1">
        {content.benefits.map(({ icon: Icon, text }) => (
          <li key={text}>
            <Item size="sm" className="px-0">
              <ItemMedia variant="avatar"><Icon aria-hidden="true" /></ItemMedia>
              <ItemContent className="min-w-0"><ItemTitle truncate={false} className="whitespace-normal">{text}</ItemTitle></ItemContent>
            </Item>
          </li>
        ))}
      </ul>
      {!sheet ? <IntroActions primary={content.primary} secondary={content.secondary} availability={content.availability} /> : null}
    </div>
  );
}

export function FeatureIntro(props: FeatureIntroContent & { size?: "default" | "compact" }) {
  return <Card><CardContent><IntroBody content={props} size={props.size} /></CardContent></Card>;
}

/** @public Card intro states (#821) render in components/ui/feature-intro.stories.tsx. */
export function FeatureIntroSheet(props: FeatureIntroContent & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secondary: { label: string; onClick: () => void };
}) {
  return (
    <Drawer open={props.open} onOpenChange={props.onOpenChange}>
      <DrawerContent>
        <div className="min-h-0 overflow-y-auto px-4 pt-4">
          <IntroBody content={props} sheet />
        </div>
        <DrawerFooter>
          <IntroActions primary={props.primary} secondary={props.secondary} availability={props.availability} />
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/** @public Card intro loading state (#821) renders in components/ui/feature-intro.stories.tsx. */
export function FeatureIntroSkeleton({ size = "default" }: { size?: "default" | "compact" }) {
  return (
    <Card role="status" aria-busy="true" aria-label="Loading introduction">
      <CardContent>
        <div className="space-y-5" aria-hidden="true">
          <Skeleton className={size === "compact" ? "mx-auto aspect-[3/2] w-full max-w-40" : "mx-auto aspect-[3/2] w-full max-w-60"} />
          <Skeleton className="mx-auto h-8 w-56" />
          <div className="space-y-1 rounded-lg border px-3 py-1">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex items-center gap-2.5 py-2.5">
                <Skeleton className="size-7 rounded-full" /><Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
          <Skeleton className="h-11 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
