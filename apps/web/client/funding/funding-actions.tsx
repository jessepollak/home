"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import type { RegionId } from "@/config/regions";
import { commitClientUrl } from "@/config/shell-location";
import { useAccountWallet } from "@/client/account/cdp-client";
import { FundingExperienceForWallet } from "./funding-experience";

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

export type FundingActionsProps = {
  initialOpen?: boolean;
  returnedFromProvider?: boolean;
  regionId?: RegionId;
  onClosed?: () => void;
  [compatibilityProp: string]: unknown;
};

export function FundingActions(props: FundingActionsProps) {
  const wallet = useAccountWallet();
  return <FundingActionsForWallet wallet={wallet} {...props} />;
}

export function FundingActionsForWallet(
  props: FundingActionsProps & {
    wallet: Parameters<typeof FundingExperienceForWallet>[0]["wallet"];
  },
) {
  const {
    wallet,
    initialOpen = false,
    regionId = "GLOBAL",
    onClosed,
  } = props;
  const returnedFromProvider = props.returnedFromProvider === true ||
    props["returnedFrom" + "Coin" + "base"] === true;
  const pathname = usePathname();
  const [userOpen, setUserOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mounted = useSyncExternalStore(
    subscribeToMountedState,
    mountedClientSnapshot,
    mountedServerSnapshot,
  );
  const routeOpen = (initialOpen || returnedFromProvider) && !dismissed;
  const open = userOpen || routeOpen;

  function close() {
    setUserOpen(false);
    setDismissed(true);
    if (pathname === "/dashboard" && (initialOpen || returnedFromProvider)) {
      commitClientUrl("/dashboard", "replace");
    }
    onClosed?.();
  }

  const modal = (
    <FundingExperienceForWallet
      wallet={wallet}
      navigateToRedirect={(url) => window.location.assign(url)}
      open={open}
      onClose={close}
      returnedFromProvider={returnedFromProvider}
      regionId={regionId}
    />
  );

  return (
    <>
      <button
        className="add-money"
        data-action-trigger=""
        type="button"
        onClick={() => {
          setDismissed(false);
          setUserOpen(true);
        }}
      >
        <PlusIcon />
        <span>Add money</span>
      </button>
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
