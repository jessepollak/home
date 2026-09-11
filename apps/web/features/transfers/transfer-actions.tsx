"use client";

import { useEffect, useMemo, useState } from "react";
import { AddressText } from "@/components/address";
import {
  useAccountWallet,
  type AccountWalletClient,
} from "@/features/account/cdp-client";
import { MoneyModal, MoneyModalFooter, MoneyModalHeader } from "@/features/money-modal";
import modal from "@/features/money-modal/money-modal.module.css";
import { releaseMoneyActionAdmission } from "@/features/money-actions/client";
import { SendDialog } from "./send-dialog";
import { TRANSFER_ASSETS, formatSendConfirmAmount } from "./transfer-helpers";
import type { ConfirmedTransfer } from "./types";
import styles from "./transfers.module.css";

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
  const [openModal, setOpenModal] = useState<"send" | "receive" | null>(null);
  const [modalOwner, setModalOwner] = useState<string | null>(null);
  const [success, setSuccess] = useState<ConfirmedTransfer | null>(null);
  const boundary = walletBoundary(wallet);
  const verifiedAddress =
    wallet.status === "verified" ? wallet.session?.smartAccount?.address ?? null : null;
  const visibleModal = modalOwner === boundary ? openModal : null;
  const dropPrivate = modalOwner !== null && modalOwner !== boundary;
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

  const open = (modalName: "send" | "receive") => {
    if (!boundary) return;
    setSuccess(null);
    setModalOwner(boundary);
    setOpenModal(modalName);
  };
  const close = () => {
    setOpenModal(null);
  };
  const finishClose = () => {
    setOpenModal(null);
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
        type="button"
        disabled={!boundary}
        onClick={() => open("send")}
      >
        Send
      </button>
      <button
        className={styles.secondaryAction}
        type="button"
        disabled={!boundary}
        onClick={() => open("receive")}
      >
        Receive
      </button>

      <ReceiveDialog
        open={visibleModal === "receive"}
        address={verifiedAddress}
        immediate={dropPrivate}
        onClose={close}
        onClosed={finishClose}
      />
      <SendDialog
        open={visibleModal === "send"}
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
          setSuccess(transfer);
          onTransferConfirmed?.(transfer);
        }}
        onClose={close}
        onClosed={finishClose}
      />

      {success ? (
        <div className={styles.successToast} role="status">
          <span className={styles.successMark} aria-hidden="true">✓</span>
          <div>
            <strong>Sent {formatSendConfirmAmount(success.amountBaseUnits, success.assetId)}</strong>
            <p>
              {TRANSFER_ASSETS[success.assetId].symbol} · Base ·{" "}
              <AddressText address={success.recipient} />
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReceiveDialog({
  open,
  address,
  immediate = false,
  onClose,
  onClosed,
}: {
  open: boolean;
  address: `0x${string}` | null;
  immediate?: boolean;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const close = () => {
    onClose();
  };

  async function copyAddress() {
    if (!address || !navigator.clipboard?.writeText) {
      setCopyStatus("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <MoneyModal
      open={open}
      labelledBy="receive-title"
      immediate={immediate}
      onCancel={close}
      onClose={() => {
        setCopyStatus("idle");
        onClosed();
      }}
    >
      <MoneyModalHeader
        title="Receive"
        titleId="receive-title"
        onClose={close}
        closeLabel="Close receive dialog"
      />
      <div className={modal.body}>
        <div className={modal.fieldBlock}>
          <p className={modal.fieldLabel}>Your address</p>
          {address ? (
            <p className={styles.receiveAddress}>
              <AddressText address={address} />
            </p>
          ) : (
            <p className={modal.fieldHint}>Address unavailable</p>
          )}
          <p className={modal.fieldHint}>Base address</p>
        </div>
        {copyStatus === "error" ? (
          <p className={modal.error} role="alert">
            Clipboard access failed. Select and copy the address manually.
          </p>
        ) : null}
      </div>
      <MoneyModalFooter
        primaryLabel={copyStatus === "copied" ? "Copied" : "Copy address"}
        primaryDisabled={!address}
        onPrimary={() => void copyAddress()}
      />
    </MoneyModal>
  );
}

function walletBoundary(wallet: TransferWallet): string | null {
  const session = wallet.status === "verified" ? wallet.session : null;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}
