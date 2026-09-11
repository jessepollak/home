"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import type { RegionId } from "@/config/regions";
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
  returnedFromCoinbase?: boolean;
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
  returnedFromCoinbase = false,
  regionId = "GLOBAL",
  onClosed,
}: FundingActionsProps & {
  wallet: Parameters<typeof FundingExperienceForWallet>[0]["wallet"];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [userOpen, setUserOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mounted = useSyncExternalStore(
    subscribeToMountedState,
    mountedClientSnapshot,
    mountedServerSnapshot,
  );
  const routeOpen = (initialOpen || returnedFromCoinbase) && !dismissed;
  const open = userOpen || routeOpen;

  function close() {
    setUserOpen(false);
    setDismissed(true);
    if (pathname === "/dashboard" && (initialOpen || returnedFromCoinbase)) {
      router.replace("/dashboard", { scroll: false });
    }
    onClosed?.();
  }

  const modal = (
    <FundingExperienceForWallet
      wallet={wallet}
      navigateToHostedOnramp={(url) => window.location.assign(url)}
      open={open}
      onClose={close}
      returnedFromCoinbase={returnedFromCoinbase}
      regionId={regionId}
    />
  );

  return (
    <>
      <button
        className="add-money"
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
