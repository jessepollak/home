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
import { dataOwnerKey, uiBoundary } from "@/client/account/owner-keys";
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
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const SendSheet = deferSheet(() => import("./send-dialog").then((module) => module.SendDialog),
  (props) => moneySheetLoading({ title: props.entry === "send" ? "Send" : "Cash out", titleId: "send-title", closeLabel: props.entry === "send" ? "Close send dialog" : "Close cash-out dialog", onCancel: props.onClose, onClosed: props.onClosed }));

export type TransferActionsProps = {
  sendOffered?: boolean;
  initialFlow?: "send" | "cash-out" | null;
  initialActionId?: string | null;
  availableAssets?: readonly TransferAssetAvailability[];
  assetMarkResolution?: AssetMarkResolution;
  regionId?: RegionId;
  regionReady?: boolean;
  showTrigger?: boolean;
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
  initialFlow = null,
  initialActionId = null,
  availableAssets,
  assetMarkResolution,
  regionId = "US",
  regionReady = true,
  showTrigger = true,
}: TransferActionsProps & { wallet: TransferWallet }) {
  const routing = useOptionalHomeShellRouting();
  const [sendOpen, setSendOpen] = useState(false);
  const [sendOpener, setSendOpener] = useState<HTMLElement | null>(null);
  const [modalOwner, setModalOwner] = useState<string | null>(null);
  const { markOpenedInApp, takeOpenedInApp } = useFlowModal();
  const boundary = uiBoundary(wallet);
  const session = isServerVerified(wallet) ? wallet.session : null;
  const queryOwnerKey = session?.smartAccount ? dataOwnerKey(session) : null;
  const verifiedAddress = session?.smartAccount?.address ?? null;
  const routeFlow = routing ? routing.state.flow : initialFlow;
  const transferFlow = routeFlow === "send" || routeFlow === "cash-out" ? routeFlow : null;
  const routeOpen = transferFlow !== null;
  const effectiveEntry = transferFlow === "send" && (sendOffered || initialActionId !== null) ? "send" : "cash-out";
  const [entry, setEntry] = useState<"send" | "cash-out">(effectiveEntry);
  if (routing && routeOpen && entry !== effectiveEntry) setEntry(effectiveEntry);
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
      if (!routing) setSendOpener(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [boundary, routeOpen, routing]);

  const openTransfer = (flow: "send" | "cash-out", event: React.MouseEvent<HTMLButtonElement>) => {
    if (!boundary) return;
    setSendOpener(event.currentTarget);
    setEntry(flow);
    void SendSheet.preload();
    setModalOwner(boundary);
    setSendOpen(true);
    const pushed = routing
      ? routing.setFlow(flow, { opener: event.currentTarget })
      : commitFlowUrl(flowHref(window.location.pathname, flow));
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
    if (!routeOpen) setModalOwner(null);
  };
  const showReview = useCallback((actionId: string, kind: PreparedMoneyAction["kind"]) => {
    const flow = kind === "cash-out" || kind === "cash-out-withdraw" ? "cash-out" : "send";
    setEntry(flow);
    if (routing) routing.setFlow(flow, { actionId, mode: "replace", opener: routing.flowOpener ?? null });
    else commitClientUrl(flowHref(window.location.pathname, flow, actionId), "replace");
  }, [routing]);
  const showFirstStep = useCallback(() => {
    if (routing) routing.setFlow(entry, { mode: "replace", opener: routing.flowOpener ?? null });
    else commitClientUrl(flowHref(window.location.pathname, entry), "replace");
  }, [entry, routing]);
  const switchToSend = () => {
    setEntry("send");
    if (routing) routing.setFlow("send", { mode: "replace", opener: routing.flowOpener ?? null });
    else commitClientUrl(flowHref(window.location.pathname, "send"), "replace");
  };

  return (
    <>
      {showTrigger ? <>
        {sendOffered ? <Button
          data-action-trigger=""
          variant="outline"
          size="touch"
          disabled={!boundary}
          {...moneySheetIntent(SendSheet.preload)}
          onClick={(event) => openTransfer("send", event)}
        >Send</Button> : null}
        <Button
          data-action-trigger=""
          variant="outline"
          size="touch"
          disabled={!boundary}
          {...moneySheetIntent(SendSheet.preload)}
          onClick={(event) => openTransfer("cash-out", event)}
        >Cash out</Button>
      </> : null}

      <SendSheet
        key={regionId}
        open={visibleSend}
        opener={routing ? routing.flowOpener ?? null : sendOpener}
        address={verifiedAddress}
        entry={entry}
        sendOffered={sendOffered}
        onSend={switchToSend}
        immediate={dropPrivate}
        availableAssets={availableAssets}
        assetMarkResolution={assetMarkResolution}
        prepareMoneyAction={wallet.prepareMoneyAction}
        fetchAccountResource={wallet.fetchAccountResource}
        regionId={regionId}
        regionReady={regionReady}
        resumeMoneyAction={wallet.resumeMoneyAction}
        executeMoneyAction={wallet.executeMoneyAction}
        queryOwnerKey={queryOwnerKey}
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
