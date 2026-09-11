"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CopyableValue } from "@/components/copyable-value";
import { formatAddress } from "@/shared/formatting";
import {
  useAccountWallet,
  type AccountWalletClient,
} from "@/client/account/cdp-client";
import { releaseMoneyActionAdmission } from "@/client/money-actions/client";
import { SendDialog } from "./send-dialog";
import { TRANSFER_ASSETS, formatSendConfirmAmount } from "@/shared/transfers/transfer-helpers";
import type { ConfirmedTransfer } from "@/shared/transfers/types";
import styles from "./transfers.module.css";

const subscribeToMountedState = () => () => {};
const mountedClientSnapshot = () => true;
const mountedServerSnapshot = () => false;

export type TransferActionsProps = {
  onTransferConfirmed?: (transfer: ConfirmedTransfer) => void;
  availableByAsset?: Partial<Record<"usdc" | "eth", string>>;
};

type TransferWallet = Pick<
  AccountWalletClient,
  | "ownerKey"
  | "status"
  | "session"
  | "pendingTransfer"
  | "sendTransfer"
  | "checkPendingTransfer"
  | "startNewTransfer"
> & Partial<Pick<AccountWalletClient, "prepareMoneyAction" | "checkMoneyAction" | "executeMoneyAction" | "fetchAccountResource">>;

export function TransferActions(props: TransferActionsProps) {
  const wallet = useAccountWallet();
  return <TransferActionsForWallet wallet={wallet} {...props} />;
}

export function TransferActionsForWallet({
  wallet,
  onTransferConfirmed,
  availableByAsset,
}: TransferActionsProps & { wallet: TransferWallet }) {
  const [sendOpen, setSendOpen] = useState(false);
  const [modalOwner, setModalOwner] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    transfer: ConfirmedTransfer;
    owner: string | null;
  } | null>(null);
  const mounted = useSyncExternalStore(
    subscribeToMountedState,
    mountedClientSnapshot,
    mountedServerSnapshot,
  );
  const boundary = walletBoundary(wallet);
  const verifiedAddress =
    wallet.status === "verified" ? wallet.session?.smartAccount?.address ?? null : null;
  const visibleSend = modalOwner === boundary && sendOpen;
  const dropPrivate = modalOwner !== null && modalOwner !== boundary;
  const visibleSuccess = success && success.owner === boundary ? success.transfer : null;
  const fetchUnresolvedSends = useMemo(() => {
    const fetchAccountResource = wallet.fetchAccountResource;
    return fetchAccountResource
      ? (signal?: AbortSignal) => fetchAccountResource(
          "/api/actions/operations?scope=unresolved-send&limit=50",
          { signal },
        )
      : undefined;
  }, [wallet.fetchAccountResource]);
  const releaseAdmission = useMemo(() => {
    const fetchAccountResource = wallet.fetchAccountResource;
    return fetchAccountResource
      ? (id: string) => releaseMoneyActionAdmission(
          (path, init = {}) => fetchAccountResource(path, {
            method: init.method === "POST" ? "POST" : "GET",
            ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
          }),
          id,
        )
      : undefined;
  }, [wallet.fetchAccountResource]);

  const openSend = () => {
    if (!boundary) return;
    setSuccess(null);
    setModalOwner(boundary);
    setSendOpen(true);
  };
  const close = () => {
    setSendOpen(false);
  };
  const finishClose = () => {
    setSendOpen(false);
    setModalOwner(null);
  };

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  return (
    <div className={styles.actions} aria-label="Transfer actions">
      <button
        className={styles.secondaryAction}
        data-action-trigger=""
        type="button"
        disabled={!boundary}
        onClick={openSend}
      >
        Send
      </button>

      {mounted
        ? createPortal(
            <SendDialog
              open={visibleSend}
              address={verifiedAddress}
              immediate={dropPrivate}
              pendingTransfer={wallet.pendingTransfer}
              availableByAsset={availableByAsset}
              sendTransfer={wallet.sendTransfer}
              checkPendingTransfer={wallet.checkPendingTransfer}
              startNewTransfer={wallet.startNewTransfer}
              prepareMoneyAction={wallet.prepareMoneyAction}
              checkMoneyAction={wallet.checkMoneyAction}
              executeMoneyAction={wallet.executeMoneyAction}
              fetchUnresolvedSends={fetchUnresolvedSends}
              releaseAdmission={releaseAdmission}
              ownerBoundary={boundary}
              onTransferConfirmed={(transfer) => {
                setSuccess({ transfer, owner: boundary });
                onTransferConfirmed?.(transfer);
              }}
              onClose={close}
              onClosed={finishClose}
            />,
            document.body,
          )
        : null}

      {visibleSuccess ? (
        <div className={styles.successToast} role="status">
          <span className={styles.successMark} aria-hidden="true">✓</span>
          <div>
            <strong>Sent {formatSendConfirmAmount(visibleSuccess.amountBaseUnits, visibleSuccess.assetId)}</strong>
            <p>
              {TRANSFER_ASSETS[visibleSuccess.assetId].symbol} · Base ·{" "}
              <CopyableValue
                value={visibleSuccess.recipient}
                display={formatAddress(visibleSuccess.recipient)}
                valueKind="address"
              />
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function walletBoundary(wallet: TransferWallet): string | null {
  const session = wallet.status === "verified" ? wallet.session : null;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}
