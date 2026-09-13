"use client";

import { Button, Text } from "@home/ui";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { InvestAsset } from "@/config/invest-assets";
import { getTradeAssetStatus } from "@/shared/trading/assets";
import type { TradeIntentReview } from "@/shared/trading/types";
import styles from "./trade-actions.module.css";

export function TradeActions({
  asset,
  layout = "row",
}: {
  asset: InvestAsset;
  layout?: "row" | "sticky";
}) {
  const status = getTradeAssetStatus(asset.id);
  if (!status) return null;
  if (status.status === "eligibility-required") {
    return (
      <Text
        as="div"
        className={layout === "sticky" ? styles.lockedSticky : styles.locked}
        textStyle="metadata"
        tone="muted"
        role="note"
      >
        Stocks aren&apos;t available yet.
      </Text>
    );
  }

  return (
    <div className={layout === "sticky" ? styles.tradeUnavailableSticky : styles.tradeUnavailable}>
      <div
        className={layout === "sticky" ? styles.stickyActions : styles.rowActions}
        aria-label={`Trade ${asset.displayName}`}
      >
        <Button disabled>Buy</Button>
        <Button variant="secondary" disabled>Sell</Button>
      </div>
      <Text as="div" textStyle="metadata" tone="muted" role="note">
        Swaps aren&apos;t available right now.
      </Text>
    </div>
  );
}

export function parseTradeIntent(
  value: unknown,
  session: VerifiedAccountSession | null,
): TradeIntentReview | null {
  if (!session?.smartAccount || !isRecord(value) || value.status !== "signature-required") return null;
  if (
    typeof value.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ||
    typeof value.intentHash !== "string" || !/^[0-9a-f]{64}$/.test(value.intentHash) ||
    typeof value.title !== "string" ||
    typeof value.signerAddress !== "string" || !/^0x[0-9a-f]{40}$/.test(value.signerAddress) ||
    value.signingRequestId !== `trade-permit:${value.id}` ||
    !isRecord(value.signingTypedData) || !isRecord(value.signingTypedData.domain) ||
    value.signingTypedData.domain.name !== "Coinbase Smart Wallet" ||
    value.signingTypedData.domain.version !== "1" ||
    value.signingTypedData.domain.chainId !== 8453 ||
    value.signingTypedData.domain.verifyingContract !== session.smartAccount.address ||
    value.signingTypedData.primaryType !== "CoinbaseSmartWalletMessage" ||
    !isExactSigningTypes(value.signingTypedData.types) ||
    !isRecord(value.signingTypedData.message) ||
    typeof value.signingTypedData.message.hash !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(value.signingTypedData.message.hash) ||
    !isTradeReviewAmount(value.spend, false) ||
    !isTradeReviewAmount(value.receive, true) ||
    !isPermitTypedData(value.permit) ||
    !Array.isArray(value.warnings) || value.warnings.length > 12 ||
    !value.warnings.every((warning) => typeof warning === "string") ||
    typeof value.permitExpiresAt !== "string" || typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.permitExpiresAt)) || Date.parse(value.expiresAt) <= Date.now()
  ) return null;
  return value as unknown as TradeIntentReview;
}

function isPermitTypedData(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.domain) || !isRecord(value.message) || !isRecord(value.types)) return false;
  return value.primaryType === "PermitTransferFrom" &&
    value.domain.name === "Permit2" &&
    value.domain.chainId === 8453 &&
    typeof value.domain.verifyingContract === "string" &&
    /^0x[0-9a-f]{40}$/.test(value.domain.verifyingContract);
}

function isTradeReviewAmount(value: unknown, receive: boolean): boolean {
  if (!isRecord(value)) return false;
  const amount = receive ? value.minimumAmountBaseUnits : value.amountBaseUnits;
  return typeof value.assetId === "string" &&
    typeof value.symbol === "string" &&
    Number.isSafeInteger(value.decimals) && Number(value.decimals) >= 0 && Number(value.decimals) <= 255 &&
    typeof amount === "string" && /^(?:0|[1-9][0-9]*)$/.test(amount) && BigInt(amount) > BigInt(0);
}

function isExactSigningTypes(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "CoinbaseSmartWalletMessage,EIP712Domain") return false;
  return JSON.stringify(value.EIP712Domain) === JSON.stringify([
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ]) && JSON.stringify(value.CoinbaseSmartWalletMessage) === JSON.stringify([
    { name: "hash", type: "bytes32" },
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
