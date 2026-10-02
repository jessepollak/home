"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { RegionId } from "@/config/regions";
import {
  commitClientUrl,
  commitFlowUrl,
  flowHref,
  isCanonicalShellPathname,
  readClientHistoryFlag,
  withoutFlowHref,
  type ShellFlow,
} from "@/config/shell-location";
import { useAccountWallet } from "@/client/account/cdp-client";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import { uiBoundary } from "@/client/account/owner-keys";
import { useIdlePreload } from "@/client/money-modal/deferred-sheet";
import { moneySheetIntent } from "@/client/money-modal";
import { browserHomeQueryClient, useHomeQueryClient } from "@/client/query/query-client";
import { useFlowModal } from "@/client/home/use-flow-modal";
import { prefetchAddMoneyMethods } from "./funding-prefetch";
import { FundingExperienceForWallet, preloadAddMoneySheet } from "./funding-experience";
import type { AddMoneyStep } from "./add-money-dialog";

type FundingFlow = Extract<ShellFlow, "add-money" | "receive">;

export type FundingActionsProps = {
  initialOpen?: boolean;
  initialFlow?: FundingFlow | null;
  returnedFromProvider?: boolean;
  regionId?: RegionId;
  regionReady?: boolean;
  onClosed?: () => void;
  showTrigger?: boolean;
};

export function FundingActions(props: FundingActionsProps) {
  const wallet = useAccountWallet();
  return <FundingActionsForWallet wallet={wallet} {...props} />;
}

export function FundingActionsForWallet({
  wallet,
  initialOpen = false,
  initialFlow = null,
  returnedFromProvider = false,
  regionId = "GLOBAL",
  regionReady = true,
  onClosed,
  showTrigger = true,
}: FundingActionsProps & {
  wallet: Parameters<typeof FundingExperienceForWallet>[0]["wallet"];
}) {
  const pathname = usePathname();
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const routing = useOptionalHomeShellRouting();
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const [userOpen, setUserOpen] = useState(false);
  const [userOpener, setUserOpener] = useState<HTMLElement | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { mounted, markOpenedInApp, takeOpenedInApp } = useFlowModal();
  useIdlePreload(preloadAddMoneySheet, uiBoundary(wallet) !== null);
  const intent = moneySheetIntent(preloadAddMoneySheet, () => prefetchAddMoneyMethods(wallet, regionId, regionReady, queryClient));
  const routedFlow = routing?.state.flow === "add-money" || routing?.state.flow === "receive"
    ? routing.state.flow
    : null;
  const returnedFromVerification = mounted && returnedFromProvider &&
    new URLSearchParams(window.location.search).get("return") === "verification";
  const requestedFlow: FundingFlow | null = routedFlow ?? initialFlow ?? (
    returnedFromProvider ? returnedFromVerification ? "add-money" : "receive" : initialOpen ? "add-money" : null
  );
  const routeOpen = requestedFlow !== null && (routing !== null || !dismissed);
  const open = routing ? routeOpen : userOpen || routeOpen;
  const closingRef = useRef(false);
  useEffect(() => {
    if (open) closingRef.current = false;
  }, [open]);

  function setFundingFlow(flow: FundingFlow, mode: "push" | "replace", opener: HTMLElement | null): boolean {
    if (routing) return routing.setFlow(flow, { mode, opener });
    return commitFlowUrl(flowHref(pathname, flow), mode);
  }

  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    setUserOpen(false);
    setDismissed(true);
    const routingPushedEntry =
      routing !== null && readClientHistoryFlag("fundingFlowPushed");
    if (routingPushedEntry || (!routing && takeOpenedInApp())) {
      window.history.back();
    } else if (
      isCanonicalShellPathname(pathname) &&
      (requestedFlow !== null || initialOpen || returnedFromProvider)
    ) {
      if (routing) {
        routing.clearFlow({ mode: "replace", fundingReturn: true });
      } else {
        const next = new URL(
          withoutFlowHref(pathname, new URLSearchParams(window.location.search)),
          window.location.origin,
        );
        next.searchParams.delete("return");
        next.searchParams.delete("add-money");
        commitClientUrl(`${next.pathname}${next.search}`, "replace");
      }
    }
  }

  function onStepChange(step: AddMoneyStep) {
    if (!open) return;
    setFundingFlow(step === "receive" ? "receive" : "add-money", "replace", routing ? routing.flowOpener ?? null : userOpener);
  }

  const modal = (
    <FundingExperienceForWallet
      wallet={wallet}
      navigateToRedirect={(url) => window.location.assign(url)}
      open={open}
      opener={routing ? routing.flowOpener ?? null : userOpen ? userOpener : null}
      onClose={close}
      onClosed={() => {
        const before = document.activeElement;
        onClosed?.();
        const trigger = triggerRef.current;
        if (before === document.activeElement && trigger?.isConnected) {
          trigger.focus({ preventScroll: true });
        }
      }}
      returnedFromProvider={returnedFromProvider}
      returnedFromVerification={returnedFromVerification}
      initialStep={requestedFlow === "receive" ? "receive" : "method"}
      onStepChange={onStepChange}
      regionId={regionId}
      regionReady={regionReady}
    />
  );

  return (
    <>
      {showTrigger ? <a
        ref={triggerRef}
        className={buttonVariants({ size: "touch" })}
        href={flowHref(pathname, "add-money", null, new URLSearchParams())}
        {...intent}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          void preloadAddMoneySheet();
          setDismissed(false);
          setUserOpener(event.currentTarget);
          setUserOpen(true);
          if (setFundingFlow("add-money", "push", event.currentTarget) && !routing) markOpenedInApp();
        }}
      >
        <Plus className="size-4" aria-hidden="true" />
        Add money
      </a> : null}
      {mounted ? modal : null}
    </>
  );
}
