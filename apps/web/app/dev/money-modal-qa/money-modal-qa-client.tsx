"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  MoneyAmountDisplay,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyNumpad,
  moneyAssetPricing,
} from "@/features/money-modal";
import modal from "@/features/money-modal/money-modal.module.css";

const usdUsdc = moneyAssetPricing("USDC", "US");
const assetOptions = [
  { id: "usdc", label: "USDC" },
  { id: "eth", label: "ETH" },
];

export function MoneyModalQaClient() {
  const state = useSearchParams().get("state") ?? "all";
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#e8eaee",
        display: "grid",
        justifyItems: "center",
        gap: 32,
        padding: state === "all" ? "32px 16px 64px" : 0,
      }}
    >
      {state === "all" || state === "send-local" ? <SendPreview variant="local" /> : null}
      {state === "all" || state === "send-native" ? <SendPreview variant="native" /> : null}
      {state === "all" || state === "save" ? <SavePreview /> : null}
    </main>
  );
}

function SendPreview({ variant }: { variant: "local" | "native" }) {
  const [amount, setAmount] = useState("25");
  return (
    <PreviewSheet
      title="Send"
      caption={variant === "local" ? "send-local-primary" : "send-native-primary"}
      continueDisabled={false}
    >
      <MoneyAmountDisplay
        amount={amount}
        onAmountChange={setAmount}
        availableLabel="$1,240.00 available"
        assetId="usdc"
        assetLabel="USDC"
        assetOptions={assetOptions}
        onAssetChange={() => {}}
        chipSet="quick-local"
        pricing={usdUsdc}
        nativeSymbol="USDC"
        initialUnit={variant === "native" ? "native" : "local"}
      />
      <MoneyNumpad value={amount} maxDecimals={6} onChange={setAmount} />
    </PreviewSheet>
  );
}

function SavePreview() {
  const [amount, setAmount] = useState("");
  return (
    <PreviewSheet title="Deposit" caption="save-deposit-max-locked" continueDisabled>
      <MoneyAmountDisplay
        amount={amount}
        onAmountChange={setAmount}
        availableLabel="$1,240.00 available"
        availableAmount="1240"
        assetId="usdc"
        assetLabel="USDC"
        assetLocked
        chipSet="max"
        pricing={usdUsdc}
        nativeSymbol="USDC"
      />
      <MoneyNumpad value={amount} maxDecimals={6} onChange={setAmount} />
    </PreviewSheet>
  );
}

function PreviewSheet({
  title,
  caption,
  continueDisabled,
  children,
}: {
  title: string;
  caption: string;
  continueDisabled: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={caption} style={{ width: 390 }}>
      <div className={modal.sheet} style={{ position: "relative", inset: "auto", margin: 0, maxHeight: "none" }}>
        <MoneyModalHeader title={title} titleId={`${caption}-title`} onClose={() => {}} />
        <div className={modal.body}>{children}</div>
        <MoneyModalFooter
          primaryLabel="Continue"
          primaryDisabled={continueDisabled}
          onPrimary={() => {}}
        />
      </div>
    </section>
  );
}
