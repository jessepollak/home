"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, ChevronDown, Delete } from "lucide-react";
import { CurrencyMark } from "@/components/currency-mark";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import { applyNumpadKey, type NumpadKey } from "./numpad";
import {
  clampDecimal,
  formatAvailableLine,
  formatChipLabel,
  formatPrimaryAmount,
  formatSecondaryAmount,
  isAvailablePositive,
  moneyAssetPricing,
  parseAvailableDecimal,
  resolvePrimaryUnit,
  type MoneyAssetPricing,
  type MoneyChipSet,
  type MoneyPrimaryUnit,
} from "./amount-units";
import styles from "./money-modal.module.css";

export function useMoneyAssetPricing(assetSymbol: string): MoneyAssetPricing {
  return moneyAssetPricing(assetSymbol, usePresentationRegionId());
}

export function MoneyAmountDisplay({
  amount,
  onAmountChange,
  availableLabel,
  availableAmount,
  assetId,
  assetLabel,
  assetCurrency,
  assetOptions,
  onAssetChange,
  assetLocked = false,
  chipSet = "none",
  pricing,
  nativeSymbol,
  initialUnit = "local",
}: {
  amount: string;
  onAmountChange?: (value: string) => void;
  availableLabel?: string;
  availableAmount?: string | null;
  assetId?: string;
  assetLabel?: string;
  assetCurrency?: string | null;
  assetOptions?: ReadonlyArray<{ id: string; label: string }>;
  onAssetChange?: (assetId: string) => void;
  assetLocked?: boolean;
  chipSet?: MoneyChipSet;
  pricing: MoneyAssetPricing;
  nativeSymbol: string;
  initialUnit?: MoneyPrimaryUnit;
}) {
  const [requestedUnit, setRequestedUnit] = useState<MoneyPrimaryUnit>(initialUnit);
  const lastAssetId = useRef(assetId);
  const primaryUnit = resolvePrimaryUnit(pricing, requestedUnit);
  const maxAmount = availableAmount ?? parseAvailableDecimal(availableLabel ?? "");
  const availableLine = formatAvailableLine(
    availableLabel,
    primaryUnit,
    pricing,
    nativeSymbol,
  );
  const secondary = formatSecondaryAmount(amount, primaryUnit, pricing, nativeSymbol);

  useEffect(() => {
    if (lastAssetId.current === assetId) return;
    lastAssetId.current = assetId;
    setRequestedUnit("local");
  }, [assetId]);

  return (
    <div className={styles.amountBlock}>
      <div className={styles.amountToolbar}>
        <MoneyAssetPicker
          assetId={assetId}
          assetLabel={assetLabel}
          assetCurrency={assetCurrency}
          assetOptions={assetOptions}
          onAssetChange={onAssetChange}
          locked={assetLocked}
        />
        {onAmountChange ? (
          <MoneyQuickChips
            chipSet={chipSet}
            localCurrency={pricing.status === "priced" ? pricing.localCurrency : "USD"}
            primaryUnit={primaryUnit}
            availableAmount={maxAmount}
            onSelect={onAmountChange}
          />
        ) : null}
      </div>
      <p className={styles.assetAmount} data-primary-amount>
        {formatPrimaryAmount(amount, primaryUnit, pricing)}
      </p>
      {pricing.status === "priced" ? (
        <MoneyUnitToggle
          secondaryLabel={secondary}
          onToggle={() =>
            setRequestedUnit((current) => (current === "local" ? "native" : "local"))
          }
        />
      ) : null}
      {availableLine ? <p className={styles.available}>{availableLine}</p> : null}
    </div>
  );
}

export function MoneyAssetPicker({
  assetId,
  assetLabel,
  assetCurrency,
  assetOptions,
  onAssetChange,
  locked = false,
}: {
  assetId?: string;
  assetLabel?: string;
  assetCurrency?: string | null;
  assetOptions?: ReadonlyArray<{ id: string; label: string }>;
  onAssetChange?: (assetId: string) => void;
  locked?: boolean;
}) {
  if (!assetLabel) return <span />;
  const markCurrency = assetCurrency ?? (assetId === "usdc" ? "USD" : null);
  const canPick = Boolean(!locked && assetId && assetOptions && onAssetChange);

  if (!canPick) {
    return (
      <div className={styles.assetPill} aria-label={assetLabel}>
        <CurrencyMark currency={markCurrency} symbol={assetLabel} />
        <span className={styles.assetName}>{assetLabel}</span>
      </div>
    );
  }

  return (
    <label className={styles.assetPill}>
      <CurrencyMark currency={markCurrency} symbol={assetLabel} />
      <select
        aria-label="Asset"
        value={assetId}
        onChange={(event) => onAssetChange?.(event.target.value)}
      >
        {assetOptions?.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
    </label>
  );
}

export function MoneyQuickChips({
  chipSet,
  localCurrency,
  primaryUnit,
  availableAmount,
  onSelect,
}: {
  chipSet: MoneyChipSet;
  localCurrency: string;
  primaryUnit: MoneyPrimaryUnit;
  availableAmount: string | null;
  onSelect: (amount: string) => void;
}) {
  if (chipSet === "none") return null;
  const maxEnabled = isAvailablePositive(availableAmount);
  const quickDisabled = primaryUnit === "native";

  return (
    <div className={styles.chips} role="group" aria-label="Quick amounts">
      {chipSet === "quick-local" ? (
        <>
          <button
            className={styles.chip}
            type="button"
            disabled={quickDisabled}
            onClick={() => onSelect(clampDecimal("10", availableAmount))}
          >
            {formatChipLabel(10, localCurrency)}
          </button>
          <button
            className={styles.chip}
            type="button"
            disabled={quickDisabled}
            onClick={() => onSelect(clampDecimal("25", availableAmount))}
          >
            {formatChipLabel(25, localCurrency)}
          </button>
        </>
      ) : null}
      <button
        className={`${styles.chip} ${styles.chipMax}`}
        type="button"
        disabled={!maxEnabled}
        onClick={() => {
          if (availableAmount) onSelect(availableAmount);
        }}
      >
        Max
      </button>
    </div>
  );
}

export function MoneyUnitToggle({
  secondaryLabel,
  onToggle,
}: {
  secondaryLabel: string;
  onToggle: () => void;
}) {
  return (
    <button
      className={styles.unitToggle}
      type="button"
      onClick={onToggle}
      aria-label={`Show ${secondaryLabel} as the primary amount`}
    >
      <ArrowDownUp size={16} strokeWidth={2} aria-hidden="true" />
      <span>{secondaryLabel}</span>
    </button>
  );
}

const KEYS: NumpadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"];

export function MoneyNumpad({
  value,
  maxDecimals,
  onChange,
  disabled = false,
}: {
  value: string;
  maxDecimals: number;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.numpad} role="group" aria-label="Amount keypad">
      {KEYS.map((key) => (
        <button
          key={key}
          className={styles.key}
          type="button"
          disabled={disabled}
          aria-label={key === "backspace" ? "Delete last digit" : key === "." ? "Decimal point" : key}
          onClick={() => onChange(applyNumpadKey(value, key, maxDecimals))}
        >
          {key === "backspace" ? <Delete size={22} strokeWidth={1.8} /> : key}
        </button>
      ))}
    </div>
  );
}
