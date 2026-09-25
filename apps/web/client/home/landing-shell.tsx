"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import { useAccountWallet } from "@/client/account/cdp-client";
import type { CountryCode } from "@/config/regions";
import {
  commitClientUrl,
  homeHrefWithOverlays,
  parseShellLocation,
  readShellAccountParam,
} from "@/config/shell-location";
import { markHomePerformance, startHomePerformance } from "@/client/observability/perf-marks";
import { readHomeInboundPanelState } from "./panel-routing";
import { ShellHeader, SignedOutLanding } from "./shell-chrome";
import { useHomeRegion } from "./use-home-region";

const AccountSignInSheet = deferSheet(() => import("@/client/account/account-screen").then((module) => module.AccountSignInSheet));

export function LandingShell({
  detectedCountry = null,
  landingVisual,
  initialSearch,
  initialAccountOpen = false,
}: {
  detectedCountry?: CountryCode | null;
  landingVisual?: ReactNode;
  initialSearch?: string;
  initialAccountOpen?: boolean;
}) {
  const router = useRouter();
  const account = useAccountWallet();
  const landingRedirectedRef = useRef(false);
  useHomeRegion({ detectedCountry });
  const [initialUrlIntent] = useState(() => readHomeInboundPanelState(
    typeof window === "undefined"
      ? parseShellLocation("/")
      : parseShellLocation(window.location.pathname),
    new URLSearchParams(
      initialSearch ?? (typeof window === "undefined" ? "" : window.location.search),
    ),
  ));
  const [isAccountOpen, setIsAccountOpen] = useState(
    initialAccountOpen || initialUrlIntent.account === "signin",
  );

  const isVerified = account.status === "verified" && account.verification === "server";
  const isSignedOut = account.status === "signed-out" || account.status === "signout-error";

  useEffect(() => {
    if (isSignedOut) void AccountSignInSheet.preload();
  }, [isSignedOut]);

  useEffect(() => {
    startHomePerformance("/");
    const frame = window.requestAnimationFrame(() => markHomePerformance("shell:paint"));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setIsAccountOpen(
        readShellAccountParam(new URLSearchParams(window.location.search)) === "signin",
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (
      account.verification !== null &&
      readShellAccountParam(new URLSearchParams(window.location.search)) !== "signin" &&
      !landingRedirectedRef.current
    ) {
      landingRedirectedRef.current = true;
      router.replace(
        homeHrefWithOverlays(new URLSearchParams(window.location.search)),
        { scroll: false },
      );
    }
  }, [account.verification, router]);

  function openAccount() {
    setIsAccountOpen(true);
    if (readShellAccountParam(new URLSearchParams(window.location.search)) !== "signin") {
      commitClientUrl("/?account=signin");
    }
  }

  function closeAccount() {
    setIsAccountOpen(false);
    if (initialAccountOpen || readShellAccountParam(new URLSearchParams(window.location.search)) === "signin") {
      commitClientUrl("/", "replace");
      return;
    }
    window.history.back();
  }

  function signOut() {
    void account.signOut().catch(() => {});
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <ShellHeader
        isAccountSettingsOpen={false}
        nestedChromeTitle={null}
        nestedChromeBackLabel="Back"
        onNestedChromeBack={() => {}}
        routeMode="landing"
        activeNavigation="home"
        isVerified={isVerified}
        account={account}
        onHome={() => router.replace("/home")}
        onDashboard={() => router.replace("/home")}
        onSignIn={openAccount}
        onSignOut={signOut}
        onOpenSettings={() => {}}
        onCloseSettings={() => {}}
      />
      <SignedOutLanding
        isVerified={isVerified}
        signOutError={account.status === "signout-error" ? account.message : null}
        landingVisual={landingVisual}
        showCreateAccount={account.signInAvailability === "ready"}
        onDashboard={() => router.replace("/home")}
        onSignIn={openAccount}
        onRetrySignOut={() => void account.signOut().catch(() => {})}
      />
      <AccountSignInSheet
        open={isAccountOpen}
        onClose={closeAccount}
        onVerified={() => router.replace("/home")}
      />
    </div>
  );
}
