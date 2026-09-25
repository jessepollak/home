"use client";

import type { ComponentProps, ReactNode } from "react";
import { ChartLine, CircleUserRound, CreditCard, House } from "lucide-react";
import { ShellHeader } from "@/client/home/shell-chrome";
import { HomeMark } from "@/components/home-mark";
import { Button } from "@/components/ui/button";

const noop = () => undefined;
const account = { status: "verified", isSignedIn: true, ownerKey: null, session: null } as ComponentProps<typeof ShellHeader>["account"];

type Destination = "Home" | "Card" | "Invest";

const destinations = [
  { label: "Home", Icon: House }, { label: "Card", Icon: CreditCard }, { label: "Invest", Icon: ChartLine },
] as const;

function MobileNavigation({ active }: { active: Destination | null }) {
  return (
    <nav aria-label="Main navigation" className="grid grid-cols-3 border-t bg-background pb-[var(--shell-safe-area-bottom)] lg:hidden">
      {destinations.map(({ label, Icon }) => (
        <Button key={label} variant="navigation" size="lg" className="min-h-14 min-w-0 flex-col gap-1"
          aria-current={label === active ? "page" : undefined}>
          <Icon className="size-5" aria-hidden="true" /><span>{label}</span>
        </Button>
      ))}
    </nav>
  );
}

function DesktopRail({ active }: { active: Destination | null }) {
  return (
    <aside className="hidden h-dvh w-60 shrink-0 flex-col border-e bg-background lg:flex">
      <div className="flex h-14 shrink-0 items-center border-b px-6">
        <HomeMark compact onClick={noop} />
      </div>
      <nav aria-label="Desktop navigation" className="flex flex-col gap-2 py-4">
        {destinations.map(({ label, Icon }) => (
          <Button key={label} variant="navigation" size="lg" className="relative min-h-11 w-full justify-start gap-3 px-6"
            aria-current={label === active ? "page" : undefined}>
            {label === active ? <span aria-hidden="true" className="absolute start-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary" /> : null}
            <Icon className="size-5" aria-hidden="true" /><span>{label}</span>
          </Button>
        ))}
      </nav>
      <div className="mt-auto border-t py-3">
        <Button variant="navigation" size="lg" className="relative min-h-11 w-full justify-start gap-3 px-6" aria-current={active === null ? "page" : undefined}>
          {active === null ? <span aria-hidden="true" className="absolute start-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary" /> : null}
          <CircleUserRound className="size-5" aria-hidden="true" />Account
        </Button>
      </div>
    </aside>
  );
}

export function RegionalShell({ active, title, status, children }: { active: Destination | null; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-svh max-h-svh flex-col overflow-hidden bg-muted/30 lg:flex-row">
      <DesktopRail active={active} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="contents lg:hidden">
          <ShellHeader isAccountSettingsOpen={active === null} nestedChromeTitle={null} nestedChromeBackLabel="Back"
            onNestedChromeBack={noop} routeMode="dashboard" activeNavigation={active?.toLowerCase() ?? "home"} isVerified account={account}
            onHome={noop} onDashboard={noop} onSignIn={noop} onSignOut={noop} onOpenSettings={noop} onCloseSettings={noop}
            status={status} />
        </div>
        <div data-testid="regional-shell-scroll" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-160">
            <header className="hidden h-14 items-center justify-between gap-4 border-b lg:flex">
              <h1 className="min-w-0 truncate text-base font-semibold">{title}</h1>
              {status}
            </header>
            {children}
          </div>
        </div>
        <MobileNavigation active={active} />
      </div>
    </div>
  );
}
