"use client";

import { Button } from "@/components/ui/button";
import { MoneyTicker } from "@/components/money-ticker";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { CopyableValue } from "@/components/copyable-value";
import { formatAddress } from "@/shared/formatting";
import {
  useAccountWallet,
  type AccountWalletClient,
} from "@/client/account/cdp-client";
import { uiBoundary } from "@/client/account/owner-keys";
import {
  commitClientUrl,
  flowHref,
  withoutFlowHref,
} from "@/config/shell-location";
import { markHomePerformance } from "@/client/observability/perf-marks";
import { useOptionalHomeShellRouting } from "@/client/home/panel-routing";
import { useHomeToast } from "@/client/home/use-home-toast";
import { SendDialog } from "./send-dialog";
import { formatSendConfirmAmount, getTransferAsset } from "@/shared/transfers/transfer-helpers";
import type { ConfirmedTransfer, TransferAssetAvailability } from "@/shared/transfers/types";
import styles from "./transfers.module.css";

const subscribeToMountedState = () => () => {};
const mountedClientSnapshot = () => true;
const mountedServerSnapshot = () => false;

export type TransferActionsProps = {
  initialOpen?: boolean;
  initialActionId?: string | null;
  availableAssets?: readonly TransferAssetAvailability[];
};

type TransferWallet = Pick<
  AccountWalletClient,
  | "ownerKey"
  | "status"
  | "session"
  | "prepareMoneyAction"
  | "resumeMoneyAction"
  | "executeMoneyAction"
>;

export function TransferActions(props: TransferActionsProps) {
  const wallet = useAccountWallet();
  return <TransferActionsForWallet wallet={wallet} {...props} />;
}

export function TransferActionsForWallet({
  wallet,
  initialOpen = false,
  initialActionId = null,
  availableAssets,
}: TransferActionsProps & { wallet: TransferWallet }) {
  const routing = useOptionalHomeShellRouting();
  const [sendOpen, setSendOpen] = useState(false);
  const [modalOwner, setModalOwner] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    transfer: ConfirmedTransfer;
    owner: string | null;
  } | null>(null);
  const openedInAppRef = useRef(false);
  const mounted = useSyncExternalStore(
    subscribeToMountedState,
    mountedClientSnapshot,
    mountedServerSnapshot,
  );
  const boundary = uiBoundary(wallet);
  const verifiedAddress =
    wallet.status === "verified" ? wallet.session?.smartAccount?.address ?? null : null;
  const routeOpen = routing ? routing.state.flow === "send" : initialOpen;
  const visibleSend = modalOwner === boundary && (routing ? routeOpen : sendOpen);
  const dropPrivate = modalOwner !== null && modalOwner !== boundary;
  const visibleSuccess = success && success.owner === boundary ? success.transfer : null;
  const { add: addToast } = useHomeToast(boundary);

  useEffect(() => {
    if (boundary) markHomePerformance("action:first-interactive");
  }, [boundary]);

  useEffect(() => {
    if (!routeOpen || !boundary) return;
    const frame = window.requestAnimationFrame(() => {
      setSuccess(null);
      setModalOwner(boundary);
      setSendOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [boundary, routeOpen]);

  useEffect(() => {
    if (!visibleSuccess) return;
    addToast({
      id: `send:${visibleSuccess.transactionHash}`,
      tone: "success",
      role: "status",
      duration: 6_000,
      onClose: () => setSuccess(null),
      message: (
        <div className={styles.successContent}>
          <span className={styles.successMark} aria-hidden="true">✓</span>
          <div>
            <strong className="text-row-label font-semibold">
              Sent <MoneyTicker value={formatSendConfirmAmount(visibleSuccess.amountBaseUnits, visibleSuccess.assetId)} />
            </strong>
            <p className={`${styles.successDetail} text-metadata text-muted-foreground`}>
              {getTransferAsset(visibleSuccess.assetId)?.symbol ?? visibleSuccess.assetId} · Base ·{" "}
              <CopyableValue
                value={visibleSuccess.recipient}
                display={formatAddress(visibleSuccess.recipient)}
                valueKind="address"
              />
            </p>
          </div>
        </div>
      ),
    });
  }, [addToast, visibleSuccess]);

  const openSend = () => {
    if (!boundary) return;
    openedInAppRef.current = true;
    setSuccess(null);
    setModalOwner(boundary);
    setSendOpen(true);
    if (routing) routing.setFlow("send");
    else commitClientUrl(flowHref("/dashboard", "send"));
  };
  const close = () => {
    setSendOpen(false);
    if (openedInAppRef.current) {
      openedInAppRef.current = false;
      window.history.back();
    } else if (routing) {
      routing.clearFlow({ mode: "replace" });
    } else {
      commitClientUrl(withoutFlowHref("/dashboard"), "replace");
    }
  };
  const finishClose = () => {
    setSendOpen(false);
    setModalOwner(null);
  };
  const showReview = useCallback((actionId: string) => {
    if (routing) routing.setFlow("send", { actionId, mode: "replace" });
    else commitClientUrl(flowHref("/dashboard", "send", actionId), "replace");
  }, [routing]);
  const showFirstStep = useCallback(() => {
    if (routing) routing.setFlow("send", { mode: "replace" });
    else commitClientUrl(flowHref("/dashboard", "send"), "replace");
  }, [routing]);

  return (
    <div className={styles.actions} aria-label="Transfer actions">
      <Button
        className={styles.secondaryAction}
        data-action-trigger=""
        variant="secondary"
        disabled={!boundary}
        onClick={openSend}
      >
        Send
      </Button>

      {mounted
        ? createPortal(
            <SendDialog
              open={visibleSend}
              address={verifiedAddress}
              immediate={dropPrivate}
              availableAssets={availableAssets}
              prepareMoneyAction={wallet.prepareMoneyAction}
              resumeMoneyAction={wallet.resumeMoneyAction}
              executeMoneyAction={wallet.executeMoneyAction}
              ownerBoundary={boundary}
              resumeActionId={initialActionId}
              onReview={showReview}
              onInvalidResume={showFirstStep}
              onConfirmed={(transfer) => {
                setSuccess({ transfer, owner: boundary });
              }}
              onClose={close}
              onClosed={finishClose}
            />,
            document.body,
          )
        : null}

    </div>
  );
}
