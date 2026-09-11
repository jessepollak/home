"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

const AMOUNT_MIN_FONT_PROPERTY = "--money-amount-min-size";
const AMOUNT_MIN_FONT_SIZE_FALLBACK = 20;
const AMOUNT_FIT_TOLERANCE_PX = 0.5;
// Font rendering is not perfectly proportional to `font-size` (glyph advances
// and negative letter-spacing round at each size). Reserve a small headroom so
// a measured fit never overflows the container by a subpixel rounding error.
const AMOUNT_FIT_SAFETY_FACTOR = 0.97;

/**
 * Scales a formatted amount to fit the available width without changing,
 * rounding, abbreviating, ellipsizing, or clipping the value. Returns the
 * largest font size (px) up to `baseFontSize` that keeps the value inside
 * `availableWidth` given its measured `naturalWidth` at `baseFontSize`.
 * Below `minFontSize` it stops shrinking and the full value stays visible.
 */
export function fitAmountFontSize(
  availableWidth: number,
  naturalWidth: number,
  baseFontSize: number,
  minFontSize: number,
): number {
  if (
    !Number.isFinite(availableWidth)
    || !Number.isFinite(naturalWidth)
    || !Number.isFinite(baseFontSize)
    || availableWidth <= 0
    || naturalWidth <= 0
    || baseFontSize <= 0
  ) {
    return baseFontSize;
  }
  if (availableWidth >= naturalWidth) return baseFontSize;
  const scaled = (baseFontSize * availableWidth) / naturalWidth;
  return Math.min(baseFontSize, Math.max(minFontSize, scaled));
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function triggerKeyHaptic(durationMs = 12): void {
  if (prefersReducedMotion()) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(durationMs);
  } catch {
    // Haptics are optional; unsupported or blocked devices stay silent.
  }
}

export function useAutoFitAmountText(text: string) {
  const containerRef = useRef<HTMLParagraphElement>(null);
  const sizerRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const sizer = sizerRef.current;
    if (!container || !sizer) return;

    const measure = () => {
      const computed = window.getComputedStyle(container);
      const horizontalPadding =
        (Number.parseFloat(computed.paddingLeft) || 0)
        + (Number.parseFloat(computed.paddingRight) || 0);
      const available = container.clientWidth - horizontalPadding;
      const natural = sizer.getBoundingClientRect().width;
      if (available <= 0 || natural <= 0) return;

      const base = Number.parseFloat(window.getComputedStyle(sizer).fontSize);
      if (!Number.isFinite(base) || base <= 0) return;

      const minRaw = computed.getPropertyValue(AMOUNT_MIN_FONT_PROPERTY);
      const min = Number.parseFloat(minRaw) || AMOUNT_MIN_FONT_SIZE_FALLBACK;
      // Round down and reserve headroom so the rendered amount never exceeds
      // the container by a subpixel rounding error; the exact decimal string
      // is never altered.
      const target =
        Math.floor(
          fitAmountFontSize(available * AMOUNT_FIT_SAFETY_FACTOR, natural, base, min) * 10,
        ) / 10;

      setFontSize((current) =>
        current !== undefined && Math.abs(current - target) < AMOUNT_FIT_TOLERANCE_PX
          ? current
          : target,
      );
    };

    measure();

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(container);
      observer.observe(sizer);
    }

    let active = true;
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    fonts?.ready?.then(() => {
      if (active) measure();
    }).catch(() => {});

    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [text]);

  return { containerRef, sizerRef, fontSize };
}

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
      <MoneyPrimaryAmount amount={amount} unit={primaryUnit} pricing={pricing} />
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

export function MoneyPrimaryAmount({
  amount,
  unit,
  pricing,
}: {
  amount: string;
  unit: MoneyPrimaryUnit;
  pricing: MoneyAssetPricing;
}) {
  const text = formatPrimaryAmount(amount, unit, pricing);
  const { containerRef, sizerRef, fontSize } = useAutoFitAmountText(text);

  return (
    <>
      <p
        ref={containerRef}
        className={styles.assetAmount}
        data-primary-amount
        style={fontSize === undefined ? undefined : { fontSize }}
      >
        {text}
      </p>
      <span
        ref={sizerRef}
        className={styles.amountSizer}
        data-amount-sizer
        aria-hidden="true"
      >
        {text}
      </span>
    </>
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
          onClick={() => {
            const next = applyNumpadKey(value, key, maxDecimals);
            if (next === value) return;
            onChange(next);
            triggerKeyHaptic();
          }}
        >
          {key === "backspace" ? (
            <Delete size={22} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            key
          )}
        </button>
      ))}
    </div>
  );
}
