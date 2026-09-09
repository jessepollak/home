"use client";

import { ChevronDown, Delete } from "lucide-react";
import { CurrencyMark } from "@/components/currency-mark";
import { applyNumpadKey, type NumpadKey } from "./numpad";
import styles from "./money-modal.module.css";

export function MoneyAmountDisplay({
  amount,
  prefix = "",
  suffix = "",
  availableLabel,
  assetId,
  assetLabel,
  assetOptions,
  onAssetChange,
}: {
  amount: string;
  prefix?: string;
  suffix?: string;
  availableLabel?: string;
  assetId?: string;
  assetLabel?: string;
  assetOptions?: ReadonlyArray<{ id: string; label: string }>;
  onAssetChange?: (assetId: string) => void;
}) {
  const figure = `${prefix}${amount || "0"}${suffix}`;
  const showAsset = Boolean(assetId && assetLabel && assetOptions && onAssetChange);
  return (
    <div className={styles.amountBlock}>
      {showAsset && assetId && assetLabel && assetOptions && onAssetChange ? (
        <label className={styles.assetPill}>
          <CurrencyMark
            currency={assetId === "usdc" ? "USD" : assetId.toUpperCase()}
            symbol={assetLabel}
          />
          <select
            aria-label="Asset"
            value={assetId}
            onChange={(event) => onAssetChange(event.target.value)}
          >
            {assetOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
        </label>
      ) : null}
      <p className={styles.assetAmount}>{figure}</p>
      {availableLabel ? <p className={styles.available}>{availableLabel}</p> : null}
    </div>
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
