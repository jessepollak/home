"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { HomeMark } from "@/components/home-mark";
import { ProfileMark } from "@/components/profile-mark";
import { useAccountWallet } from "@/client/account/cdp-client";
import {
  publicHeaderFrameClassName,
  shellChromeCompensationClassName,
  shellContentFrameClassName,
} from "@/components/shell-layout";

export function ShellHeader({
  isAccountSettingsOpen,
  nestedChromeTitle,
  nestedChromeBackLabel,
  onNestedChromeBack,
  routeMode,
  activeNavigation,
  isVerified,
  account,
  onHome,
  onDashboard,
  onSignIn,
  onSignOut,
  onOpenSettings,
  onCloseSettings,
}: {
  isAccountSettingsOpen: boolean;
  nestedChromeTitle: string | null;
  nestedChromeBackLabel: string;
  onNestedChromeBack: () => void;
  routeMode: "landing" | "dashboard";
  activeNavigation: string;
  isVerified: boolean;
  account: ReturnType<typeof useAccountWallet>;
  onHome: () => void;
  onDashboard: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}) {
  const dashboardTitle = isAccountSettingsOpen
    ? "Account"
    : nestedChromeTitle ?? (activeNavigation === "invest" ? "Invest" : "Home");
  const hasNestedChrome = !isAccountSettingsOpen && nestedChromeTitle !== null;

  const headerFrameClassName = routeMode === "landing"
    ? publicHeaderFrameClassName
    : shellContentFrameClassName;

  return (
    <header className={`order-0 w-full shrink-0 bg-background ${shellChromeCompensationClassName}`}>
      <div
        className={`${headerFrameClassName} flex min-h-14 items-center justify-between gap-4 border-b py-2`}
        data-shell-header-frame={routeMode}
      >
      {routeMode === "dashboard" ? (
        <div className="flex min-w-0 items-center gap-2" data-shell-header-main="">
          {hasNestedChrome ? (
            <div
              className="flex h-11 w-11 shrink-0 items-center md:h-7 md:w-31"
              data-shell-back=""
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-11 md:size-7"
                aria-label={nestedChromeBackLabel}
                onClick={onNestedChromeBack}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <HomeMark onClick={() => { if (isVerified) onHome(); }} />
          )}
          <h1
            className="min-w-0 truncate text-base font-semibold"
            data-shell-header-title=""
          >
            {dashboardTitle}
          </h1>
        </div>
      ) : (
        <div className="flex min-w-0 items-center">
          <HomeMark onClick={() => { if (isVerified) onHome(); }} />
        </div>
      )}
      <div className="flex shrink-0 items-center">
        {isAccountSettingsOpen ? (
          <Button variant="secondary" onClick={onCloseSettings}>Done</Button>
        ) : (
          <HeaderAccountAction
            status={account.status}
            isSignedIn={account.isSignedIn}
            routeMode={routeMode}
            ownerKey={account.ownerKey}
            address={account.session?.smartAccount?.address ?? null}
            onDashboard={onDashboard}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            onOpenSettings={onOpenSettings}
          />
        )}
      </div>
      </div>
    </header>
  );
}

function HeaderAccountAction({
  status,
  isSignedIn,
  routeMode,
  ownerKey,
  address,
  onDashboard,
  onSignIn,
  onSignOut,
  onOpenSettings,
}: {
  status: ReturnType<typeof useAccountWallet>["status"];
  isSignedIn: boolean;
  routeMode: "landing" | "dashboard";
  ownerKey: string | null;
  address: string | null;
  onDashboard: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
}) {
  if (status === "signout-error") {
    return <Button onClick={onSignOut}>Retry sign out</Button>;
  }
  if (routeMode === "dashboard") {
    const checking = status === "restoring" || status === "validating";
    const signedIn = status === "verified" || (status === "unavailable" && isSignedIn);
    if (checking || signedIn) {
      return (
        <ProfileMark
          status={checking ? "loading" : "ready"}
          ownerKey={ownerKey}
          address={address}
          disabled={checking}
          onClick={signedIn && !checking ? onOpenSettings : undefined}
        />
      );
    }
  }
  if (status === "restoring" || status === "validating") {
    return <Button variant="secondary" disabled>Account</Button>;
  }
  if (status === "verified" || (status === "unavailable" && isSignedIn)) {
    return <Button onClick={onDashboard}>Dashboard</Button>;
  }
  return <Button onClick={onSignIn}>Sign in</Button>;
}

export function SignedOutLanding({
  isVerified,
  signOutError,
  landingVisual,
  showCreateAccount,
  onDashboard,
  onSignIn,
  onRetrySignOut,
}: {
  isVerified: boolean;
  signOutError: string | null;
  landingVisual?: ReactNode;
  showCreateAccount: boolean;
  onDashboard: () => void;
  onSignIn: () => void;
  onRetrySignOut: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col md:grid md:grid-cols-2">
      {landingVisual ? (
        <div className="flex min-h-64 items-center justify-center overflow-hidden bg-muted md:min-h-0">{landingVisual}</div>
      ) : null}
      <section className="flex items-center p-6 md:p-12" aria-labelledby="landing-title">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
          <h1 className="text-4xl font-semibold tracking-tight" id="landing-title">
            One home for your money.
          </h1>
          <p className="text-lg text-muted-foreground">
            Invest in any asset, earn more on your savings, and grow your wealth.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {isVerified ? (
              <Button size="lg" className="h-11" onClick={onDashboard}>Open dashboard</Button>
            ) : (
              <>
                <Button size="lg" className="h-11" onClick={onSignIn}>Sign in</Button>
                {showCreateAccount ? (
                  <Button size="lg" className="h-11" variant="secondary" onClick={onSignIn}>
                    Create account
                  </Button>
                ) : null}
              </>
            )}
          </div>
          {signOutError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{signOutError}</AlertDescription>
              <AlertAction>
                <Button variant="ghost" onClick={onRetrySignOut}>Retry sign out</Button>
              </AlertAction>
            </Alert>
          ) : null}
        </div>
      </section>
    </main>
  );
}
