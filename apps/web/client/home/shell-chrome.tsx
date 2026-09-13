"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { HomeMark } from "@/components/home-mark";
import { ProfileMark } from "@/components/profile-mark";
import { useAccountWallet } from "@/client/account/cdp-client";

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
  return (
    <header className="order-0 mx-auto flex min-h-14 w-full max-w-2xl shrink-0 items-center justify-between gap-4 border-b bg-background px-4 py-2">
      <div className="flex min-w-0 items-center">
        {isAccountSettingsOpen ? (
          <h1 className="text-base font-semibold">Account</h1>
        ) : nestedChromeTitle ? (
          <NestedHomeHeader
            title={nestedChromeTitle}
            backLabel={nestedChromeBackLabel}
            onBack={onNestedChromeBack}
          />
        ) : routeMode === "dashboard" && activeNavigation === "invest" ? (
          <h1 className="text-base font-semibold">Invest</h1>
        ) : (
          <HomeMark onClick={() => { if (isVerified) onHome(); }} />
        )}
      </div>
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

function NestedHomeHeader({
  title,
  backLabel,
  onBack,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button variant="ghost" size="icon" onClick={onBack} aria-label={backLabel}>
        <ArrowLeft className="size-4" aria-hidden="true" />
      </Button>
      <h1 className="min-w-0 text-base font-semibold">{title}</h1>
    </div>
  );
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
        <div className="min-h-64 overflow-hidden bg-muted md:min-h-0">{landingVisual}</div>
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
