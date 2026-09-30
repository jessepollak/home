"use client";

import { Button } from "@/components/ui/button";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  isServerVerified,
  useAccountWallet,
  type AccountWalletClient,
} from "@/client/account/cdp-client";
import { uiBoundary } from "@/client/account/owner-keys";
import {
  commitClientUrl,
  commitFlowUrl,
  flowHref,
  withoutFlowHref,
} from "@/config/shell-location";
import { markHomePerformance } from "@/client/observability/perf-marks";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import { deferSheet, useIdlePreload } from "@/client/money-modal/deferred-sheet";
import { moneySheetIntent, moneySheetLoading } from "@/client/money-modal";
import { useFlowModal } from "@/client/home/use-flow-modal";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import type { TransferAssetAvailability } from "@/shared/transfers/types";
import type { RegionId } from "@/config/regions";

const SendSheet = deferSheet(() => import("./send-dialog").then((module) => module.SendDialog),
  (props) => moneySheetLoading({ title: props.sendOffered ? "Send" : "Cash out", titleId: "send-title", closeLabel: props.sendOffered ? "Close send dialog" : "Close cash-out dialog", onCancel: props.onClose, onClosed: props.onClosed }));

export type TransferActionsProps = {
  sendOffered?: boolean;
  initialOpen?: boolean;
  initialActionId?: string | null;
  availableAssets?: readonly TransferAssetAvailability[];
  assetMarkResolution?: AssetMarkResolution;
  regionId?: RegionId;
  regionReady?: boolean;
};

type TransferWallet = Pick<
  AccountWalletClient,
  | "ownerKey"
  | "status"
  | "verification"
  | "session"
  | "prepareMoneyAction"
  | "fetchAccountResource"
  | "resumeMoneyAction"
  | "executeMoneyAction"
>;

export function TransferActions(props: TransferActionsProps) {
  const wallet = useAccountWallet();
  return <TransferActionsForWallet wallet={wallet} {...props} />;
}

export function TransferActionsForWallet({
  wallet,
  sendOffered = true,
  initialOpen = false,
  initialActionId = null,
  availableAssets,
  assetMarkResolution,
  regionId = "US",
  regionReady = true,
}: TransferActionsProps & { wallet: TransferWallet }) {
  const routing = useOptionalHomeShellRouting();
  const [sendOpen, setSendOpen] = useState(false);
  const [modalOwner, setModalOwner] = useState<string | null>(null);
  const { markOpenedInApp, takeOpenedInApp } = useFlowModal();
  const boundary = uiBoundary(wallet);
  const verifiedAddress = isServerVerified(wallet)
    ? wallet.session.smartAccount?.address ?? null
    : null;
  const routeOpen = routing ? routing.state.flow === "send" : initialOpen;
  const visibleSend = modalOwner === boundary && (routing ? routeOpen : sendOpen);
  const dropPrivate = modalOwner !== null && modalOwner !== boundary;

  useEffect(() => {
    if (boundary) markHomePerformance("action:first-interactive");
  }, [boundary]);
  useIdlePreload(SendSheet.preload, Boolean(boundary));

  useEffect(() => {
    if (!routeOpen || !boundary) return;
    const frame = window.requestAnimationFrame(() => {
      setModalOwner(boundary);
      setSendOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [boundary, routeOpen]);

  const openSend = () => {
    if (!boundary) return;
    void SendSheet.preload();
    setModalOwner(boundary);
    setSendOpen(true);
    const pushed = routing
      ? routing.setFlow("send")
      : commitFlowUrl(flowHref(window.location.pathname, "send"));
    if (pushed) markOpenedInApp();
  };
  const close = () => {
    setSendOpen(false);
    if (takeOpenedInApp()) {
      window.history.back();
    } else if (routing) {
      routing.clearFlow({ mode: "replace" });
    } else {
      commitClientUrl(withoutFlowHref(window.location.pathname), "replace");
    }
  };
  const finishClose = () => {
    setSendOpen(false);
    setModalOwner(null);
  };
  const showReview = useCallback((actionId: string) => {
    if (routing) routing.setFlow("send", { actionId, mode: "replace" });
    else commitClientUrl(flowHref(window.location.pathname, "send", actionId), "replace");
  }, [routing]);
  const showFirstStep = useCallback(() => {
    if (routing) routing.setFlow("send", { mode: "replace" });
    else commitClientUrl(flowHref(window.location.pathname, "send"), "replace");
  }, [routing]);

  return (
    <>
      <Button
        data-action-trigger=""
        variant="outline"
        size="touch"
        disabled={!boundary}
        {...moneySheetIntent(SendSheet.preload)}
        onClick={openSend}
      >
        {sendOffered ? "Send" : "Cash out"}
      </Button>

      <SendSheet
        key={regionId}
        open={visibleSend}
        address={verifiedAddress}
        sendOffered={sendOffered}
        immediate={dropPrivate}
        availableAssets={availableAssets}
        assetMarkResolution={assetMarkResolution}
        prepareMoneyAction={wallet.prepareMoneyAction}
        fetchAccountResource={wallet.fetchAccountResource}
        regionId={regionId}
        regionReady={regionReady}
        resumeMoneyAction={wallet.resumeMoneyAction}
        executeMoneyAction={wallet.executeMoneyAction}
        ownerBoundary={boundary}
        resumeActionId={initialActionId}
        onReview={showReview}
        onInvalidResume={showFirstStep}
        onSubmitted={showFirstStep}
        onClose={close}
        onClosed={finishClose}
      />
    </>
  );
}
