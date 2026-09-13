"use client";

import type { ReactNode } from "react";
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
    <header className="app-header">
      <div className="app-header-start">
        {isAccountSettingsOpen ? (
          <h1 className="app-header-lead-title text-section-title">Account</h1>
        ) : nestedChromeTitle ? (
          <NestedHomeHeader
            title={nestedChromeTitle}
            backLabel={nestedChromeBackLabel}
            onBack={onNestedChromeBack}
          />
        ) : routeMode === "dashboard" && activeNavigation === "invest" ? (
          <h1 className="app-header-lead-title text-section-title">Invest</h1>
        ) : (
          <HomeMark onClick={() => { if (isVerified) onHome(); }} />
        )}
      </div>
      <span className="app-header-title-slot" aria-hidden="true" />
      <div className="app-header-end">
        {isAccountSettingsOpen ? (
          <Button className="header-done-link" variant="secondary" onClick={onCloseSettings}>
            Done
          </Button>
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
    return <Button className="header-account-link" onClick={onSignOut}>Retry sign out</Button>;
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
    return <Button className="header-account-link header-account-quiet" variant="secondary" disabled>Account</Button>;
  }
  if (status === "verified" || (status === "unavailable" && isSignedIn)) {
    return <Button className="header-account-link" onClick={onDashboard}>Dashboard</Button>;
  }
  return <Button className="header-account-link" onClick={onSignIn}>Sign in</Button>;
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
    <div className="header-leading">
      <Button className="header-back-link" variant="ghost" onClick={onBack} aria-label={backLabel}>
        <span aria-hidden="true">←</span>
      </Button>
      <h1 className="header-panel-title app-header-title text-section-title">{title}</h1>
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
    <main className={`landing-main${landingVisual ? " landing-main-with-visual" : ""}`}>
      {landingVisual ? <div className="landing-visual">{landingVisual}</div> : null}
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-content flex flex-col gap-6">
          <h1 className="landing-heading text-page-title" id="landing-title">
            One home for your money.
          </h1>
          <p className="landing-copy text-caption text-muted-foreground">
            Invest in any asset, earn more on your savings, and grow your wealth.
          </p>
          <div className="landing-actions flex items-center gap-3">
            {isVerified ? (
              <Button onClick={onDashboard}>Open dashboard</Button>
            ) : (
              <>
                <Button onClick={onSignIn}>Sign in</Button>
                {showCreateAccount ? (
                  <Button variant="secondary" onClick={onSignIn}>Create account</Button>
                ) : null}
              </>
            )}
          </div>
          {signOutError ? (
            <Alert className="landing-status" variant="destructive" role="alert">
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
