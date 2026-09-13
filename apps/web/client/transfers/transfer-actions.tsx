"use client";

import { Button, Text, Toast, ToastViewport } from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
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
import { SendDialog } from "./send-dialog";
import { TRANSFER_ASSETS, formatSendConfirmAmount } from "@/shared/transfers/transfer-helpers";
import type { ConfirmedTransfer } from "@/shared/transfers/types";
import styles from "./transfers.module.css";

const subscribeToMountedState = () => () => {};
const mountedClientSnapshot = () => true;
const mountedServerSnapshot = () => false;

export type TransferActionsProps = {
  initialOpen?: boolean;
  initialActionId?: string | null;
  availableByAsset?: Partial<Record<"usdc" | "eth", string>>;
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
  availableByAsset,
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
              availableByAsset={availableByAsset}
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

      {visibleSuccess ? (
        <ToastViewport>
          <Toast key={visibleSuccess.transactionHash} tone="success" duration={6000} onDismiss={() => setSuccess(null)}>
            <div className={styles.successContent}>
              <span className={styles.successMark} aria-hidden="true">✓</span>
              <div>
                <Text as="strong" textStyle="row-label">
                  Sent <MoneyTicker value={formatSendConfirmAmount(visibleSuccess.amountBaseUnits, visibleSuccess.assetId)} />
                </Text>
                <Text textStyle="metadata" tone="muted" className={styles.successDetail}>
                  {TRANSFER_ASSETS[visibleSuccess.assetId].symbol} · Base ·{" "}
                  <CopyableValue
                    value={visibleSuccess.recipient}
                    display={formatAddress(visibleSuccess.recipient)}
                    valueKind="address"
                  />
                </Text>
              </div>
            </div>
          </Toast>
        </ToastViewport>
      ) : null}
    </div>
  );
}
