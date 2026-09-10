"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import {
  BuyBody,
  MethodBody,
  ReceiveBody,
} from "@/features/funding/add-money-dialog";
import {
  MoneyModalFooter,
  MoneyModalHeader,
} from "@/features/money-modal";
import modal from "@/features/money-modal/money-modal.module.css";

const ADDRESS = "0x22111d000000000000000000000000000077daa9" as const;

export function AddMoneyQaClient() {
  const state = useSearchParams().get("state") ?? "all";
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#e8eaee",
        display: "grid",
        justifyItems: "center",
        gap: 32,
        padding: state === "all" ? "32px 0 64px" : 0,
      }}
    >
      {state === "all" || state === "method" ? <MethodPreview /> : null}
      {state === "all" || state === "receive" ? <ReceivePreview /> : null}
      {state === "all" || state === "buy" ? <BuyPreview /> : null}
    </main>
  );
}

function MethodPreview() {
  return (
    <PreviewSheet title="Add money" caption="add-money-method">
      <MethodBody onSelectReceive={() => {}} onSelectBuy={() => {}} />
    </PreviewSheet>
  );
}

function ReceivePreview() {
  return (
    <PreviewSheet title="Receive" caption="add-money-receive" onBack={() => {}}>
      <ReceiveBody address={ADDRESS} regionId="ID" />
    </PreviewSheet>
  );
}

function BuyPreview() {
  return (
    <PreviewSheet
      title="Buy"
      caption="add-money-buy"
      onBack={() => {}}
      footer={
        <MoneyModalFooter
          primaryLabel="Continue to Coinbase"
          onPrimary={() => {}}
          secondaryLabel="Back"
          onSecondary={() => {}}
        />
      }
    >
      <BuyBody />
    </PreviewSheet>
  );
}

function PreviewSheet({
  title,
  caption,
  onBack,
  footer,
  children,
}: {
  title: string;
  caption: string;
  onBack?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={caption} style={{ width: "100%", maxWidth: 390, alignSelf: "start" }}>
      <div
        className={modal.sheet}
        data-money-sheet=""
        style={{
          position: "relative",
          inset: "auto",
          margin: 0,
          maxHeight: "none",
          animation: "none",
        }}
      >
        <div className={modal.grabberHit}>
          <span className={modal.grabber} aria-hidden="true" />
        </div>
        <MoneyModalHeader
          title={title}
          titleId={`${caption}-title`}
          onBack={onBack}
          onClose={() => {}}
        />
        {children}
        {footer}
      </div>
    </section>
  );
}
