"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Button } from "@home/ui";
import type { RegionId } from "@/config/regions";
import {
  commitClientUrl,
  flowHref,
  withoutFlowHref,
  type ShellFlow,
} from "@/config/shell-location";
import { useAccountWallet } from "@/client/account/cdp-client";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import { FundingExperienceForWallet } from "./funding-experience";
import type { AddMoneyStep } from "./add-money-dialog";

const subscribeToMountedState = () => () => {};
const mountedClientSnapshot = () => true;
const mountedServerSnapshot = () => false;

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

type FundingFlow = Extract<ShellFlow, "add-money" | "receive">;

export type FundingActionsProps = {
  initialOpen?: boolean;
  initialFlow?: FundingFlow | null;
  returnedFromProvider?: boolean;
  regionId?: RegionId;
  onClosed?: () => void;
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
  onClosed,
}: FundingActionsProps & {
  wallet: Parameters<typeof FundingExperienceForWallet>[0]["wallet"];
}) {
  const pathname = usePathname();
  const routing = useOptionalHomeShellRouting();
  const [userOpen, setUserOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const openedInAppRef = useRef(false);
  const mounted = useSyncExternalStore(
    subscribeToMountedState,
    mountedClientSnapshot,
    mountedServerSnapshot,
  );
  const routedFlow = routing?.state.flow === "add-money" || routing?.state.flow === "receive"
    ? routing.state.flow
    : null;
  const requestedFlow: FundingFlow | null = routedFlow ?? initialFlow ?? (
    returnedFromProvider ? "receive" : initialOpen ? "add-money" : null
  );
  const routeOpen = requestedFlow !== null && (routing !== null || !dismissed);
  const open = routing ? routeOpen : userOpen || routeOpen;

  function setFundingFlow(flow: FundingFlow, mode: "push" | "replace") {
    if (routing) {
      routing.setFlow(flow, { mode });
      return;
    }
    commitClientUrl(flowHref("/dashboard", flow), mode);
  }

  function close() {
    setUserOpen(false);
    setDismissed(true);
    if (openedInAppRef.current) {
      openedInAppRef.current = false;
      window.history.back();
    } else if (
      pathname === "/dashboard" &&
      (requestedFlow !== null || initialOpen || returnedFromProvider)
    ) {
      if (routing) {
        routing.clearFlow({ mode: "replace", fundingReturn: true });
      } else {
        const next = new URL(
          withoutFlowHref("/dashboard", new URLSearchParams(window.location.search)),
          window.location.origin,
        );
        next.searchParams.delete("return");
        next.searchParams.delete("add-money");
        commitClientUrl(`${next.pathname}${next.search}`, "replace");
      }
    }
    onClosed?.();
  }

  function onStepChange(step: AddMoneyStep) {
    if (!open) return;
    setFundingFlow(step === "receive" ? "receive" : "add-money", "replace");
  }

  const modal = (
    <FundingExperienceForWallet
      wallet={wallet}
      navigateToRedirect={(url) => window.location.assign(url)}
      open={open}
      onClose={close}
      returnedFromProvider={returnedFromProvider}
      initialStep={requestedFlow === "receive" ? "receive" : "method"}
      onStepChange={onStepChange}
      regionId={regionId}
    />
  );

  return (
    <>
      <Button
        className="add-money"
        variant="primary"
        onClick={() => {
          openedInAppRef.current = true;
          setDismissed(false);
          setUserOpen(true);
          setFundingFlow("add-money", "push");
        }}
      >
        <span className="add-money-content">
          <PlusIcon />
          <span>Add money</span>
        </span>
      </Button>
      {mounted ? createPortal(modal, document.body) : null}
    </>
  );
}

function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
