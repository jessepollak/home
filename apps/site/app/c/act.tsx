"use client";

import { Gift, LayoutDashboard, LifeBuoy, RotateCcw, Settings, Users, Banknote, ScrollText, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActivityDemo, AddMoneyDemo, BrandDemo, CashOutDemo, SaveDemo, SendDemo } from "./demos";
import { GrowthDemo, ManagementDemo, ReferralDemo } from "./operator-demos";
import { SceneContext } from "./use-storyboard";

const demos = {
  "add-money": AddMoneyDemo,
  send: SendDemo,
  save: SaveDemo,
  "cash-out": CashOutDemo,
  activity: ActivityDemo,
  referrals: ReferralDemo,
  brand: BrandDemo,
  management: ManagementDemo,
  growth: GrowthDemo,
} satisfies Record<string, ComponentType>;

type FeatureId = keyof typeof demos;
type Frame = "phone" | "admin";

export type ActFeature = { id: FeatureId; title: string; body: ReactNode };

const adminSections: { id: string; label: string; icon: LucideIcon; scene?: FeatureId }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "customers", label: "Customers", icon: Users },
  { id: "support", label: "Support", icon: LifeBuoy, scene: "management" },
  { id: "growth", label: "Growth", icon: Gift, scene: "growth" },
  { id: "money", label: "Money", icon: Banknote },
  { id: "settings", label: "Settings", icon: Settings, scene: "brand" },
  { id: "audit", label: "Audit log", icon: ScrollText },
];

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-[25.5rem] rounded-[2.5rem] bg-background p-2 shadow-floating">
      <div className="flex h-[min(44rem,calc(100dvh-7rem))] flex-col overflow-hidden rounded-[2rem] bg-muted">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-5">
          <span aria-hidden="true" className="size-6 rounded-sm bg-primary" />
          <span className="text-base font-semibold">Home</span>
        </div>
        <div className="grid min-h-0 flex-1 overflow-hidden p-3">{children}</div>
      </div>
    </div>
  );
}

function AdminFrame({ current, children }: { current: FeatureId; children: ReactNode }) {
  const index = adminSections.findIndex((section) => section.scene === current);
  return (
    <div className="flex h-[min(42rem,calc(100dvh-7rem))] w-full max-w-[44rem] overflow-hidden rounded-xl bg-background shadow-floating">
      <div className="flex w-44 shrink-0 flex-col border-e">
        <div className="px-4 py-6 text-lg font-semibold">Home</div>
        <div className="relative grid">
          {adminSections.map((section) => (
            <span
              key={section.id}
              className={cn(
                "flex h-11 items-center gap-3 px-4 text-sm font-medium text-muted-foreground transition-colors duration-(--motion-duration-moderate) ease-standard",
                section.scene === current && "text-foreground",
              )}
            >
              <section.icon className="size-4 shrink-0" aria-hidden="true" />
              {section.label}
            </span>
          ))}
          <span
            className="absolute start-0 top-2 h-7 w-0.5 rounded-full bg-primary transition-transform duration-(--motion-duration-slow) ease-(--motion-ease-emphasized)"
            style={{ transform: `translateY(${index * 2.75}rem)` }}
          />
        </div>
      </div>
      <div className="grid min-w-0 flex-1 overflow-hidden bg-muted p-8">{children}</div>
    </div>
  );
}

export function Act({ id, frame, title, features, intro }: { id: string; frame: Frame; title: string; features: ActFeature[]; intro?: ReactNode }) {
  const [active, setActive] = useState(0);
  const [onStage, setOnStage] = useState(false);
  const [take, setTake] = useState(0);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let pending = 0;
    const measure = () => {
      pending = 0;
      const middle = window.innerHeight / 2;
      let next = 0;
      sections.current.forEach((section, index) => {
        if (section && section.getBoundingClientRect().top <= middle) next = index;
      });
      setActive(next);
    };
    const schedule = () => {
      if (!pending) pending = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (pending) window.cancelAnimationFrame(pending);
    };
  }, []);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setOnStage(entry.intersectionRatio >= 0.6);
    }, { threshold: [0, 0.6, 1] });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scenes = useMemo(() => features.map((feature, index) => ({ feature, Demo: demos[feature.id], index })), [features]);
  const current = features[active] ?? features[0];

  const panels = scenes.map(({ feature, Demo, index }) => (
      <div
        key={feature.id}
        className={cn(
          "col-start-1 row-start-1 min-w-0 transition-[opacity,translate] duration-(--motion-duration-slow) ease-(--motion-ease-emphasized) motion-reduce:transition-none",
          index < active && "-translate-y-6 opacity-0",
          index > active && "translate-y-6 opacity-0",
        )}
      >
        <SceneContext.Provider value={{ active: onStage && index === active, take, frame }}>
          <Demo />
        </SceneContext.Provider>
      </div>
  ));

  return (
    <div className={cn("md:grid md:gap-12", frame === "phone" ? "md:grid-cols-2" : "md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
      <div>
        {intro}
        {scenes.map(({ feature, Demo, index }) => (
          <section
            key={feature.id}
            ref={(element) => { sections.current[index] = element; }}
            data-scene={index}
            aria-labelledby={feature.id}
            className="grid gap-8 py-10 md:min-h-[80dvh] md:content-center md:py-0"
          >
            <div className="max-w-md">
              {index === 0 && <h2 id={id} className="mb-6 text-sm font-medium text-muted-foreground md:ps-6">{title}</h2>}
              <div className="relative md:ps-6">
                <span aria-hidden="true" className="absolute inset-y-1 start-0 hidden w-0.5 rounded-full bg-border md:block" />
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-y-1 start-0 hidden w-0.5 origin-top rounded-full bg-primary transition-transform duration-(--motion-duration-slow) ease-(--motion-ease-emphasized) md:block",
                    index === active ? "scale-y-100" : "scale-y-0",
                  )}
                />
                <h3 id={feature.id} className="text-2xl font-semibold tracking-tight text-balance">{feature.title}</h3>
                <p className="mt-3 text-base text-pretty text-foreground/70">{feature.body}</p>
              </div>
            </div>
            <div className="md:hidden">
              <Demo />
            </div>
          </section>
        ))}
        <div aria-hidden="true" className="hidden md:block md:h-[20dvh]" />
      </div>
      <div className="hidden md:block">
        <div className="sticky top-0 flex h-dvh flex-col items-center justify-center gap-3">
          <div ref={stage} inert aria-hidden="true" className="flex w-full justify-center">
            {frame === "phone" ? <PhoneFrame>{panels}</PhoneFrame> : <AdminFrame current={current.id}>{panels}</AdminFrame>}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-foreground/70 motion-reduce:hidden"
            aria-label={`Replay the ${current.title} example`}
            onClick={() => setTake((value) => value + 1)}
          >
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            Replay
          </Button>
        </div>
      </div>
    </div>
  );
}
