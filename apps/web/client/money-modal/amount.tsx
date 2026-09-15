"use client";

import { Button } from "@/components/ui/button";
import { MoneyTicker } from "@/components/money-ticker";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownUp, Delete } from "lucide-react";
import { CurrencyMark } from "@/components/currency-mark";
import { InputGroupAddon } from "@/components/ui/input-group";
import type { AssetMarkPresentation } from "@/client/asset-mark/presentation";
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

const AMOUNT_MIN_FONT_PROPERTY = "--money-amount-min-size";
const AMOUNT_MIN_FONT_SIZE_FALLBACK = 20;
const AMOUNT_FIT_TOLERANCE_PX = 0.5;
// Font rendering is not perfectly proportional to `font-size` (glyph advances
// and negative letter-spacing round at each size). Reserve a small headroom so
// a measured fit never overflows the container by a subpixel rounding error.
const AMOUNT_FIT_SAFETY_FACTOR = 0.97;

export type MoneyAmountChangeSource = "keypad" | "programmatic";

export type MoneyAssetOption = {
  id: string;
  label: string;
  description?: string;
  currency?: string | null;
  mark?: AssetMarkPresentation;
};

export function matchesMoneyAssetOption(
  option: MoneyAssetOption,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${option.currency ?? ""} ${option.description ?? ""} ${option.label}`
    .toLocaleLowerCase()
    .includes(normalized);
}

export function shouldAnimatePrimaryAmount(
  previousAmount: string,
  amount: string,
  changeSource: MoneyAmountChangeSource,
): boolean {
  return previousAmount === amount || changeSource === "programmatic";
}

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
  const containerRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState<number | undefined>(undefined);
  const [scaleX, setScaleX] = useState(1);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const sizer = sizerRef.current;
    if (!container || !sizer) return;

    // Re-measure only when the text changes (effect deps), fonts settle, or the
    // container's inline width changes. Our own font-size change alters the
    // container's height and the ticker's box; feeding those back would oscillate.
    let lastWidth = -1;
    const measure = () => {
      lastWidth = container.clientWidth;
      const computed = window.getComputedStyle(container);
      const horizontalPadding =
        (Number.parseFloat(computed.paddingLeft) || 0)
        + (Number.parseFloat(computed.paddingRight) || 0);
      const available = container.clientWidth - horizontalPadding;
      const base = Number.parseFloat(window.getComputedStyle(sizer).fontSize);
      const currentSize = Number.parseFloat(computed.fontSize);
      // Measure the ticker box itself (what is laid out). The primary ticker opts
      // out of grow-only digit reservation, so deleting digits shrinks this box and
      // lets the amount return to its full type size without remounting the ticker.
      const ticker = container.querySelector<HTMLElement>("[data-slot=\"money-ticker\"]");
      const renderedNatural = ticker?.offsetWidth || sizer.getBoundingClientRect().width;
      if (available <= 0 || renderedNatural <= 0 || !Number.isFinite(base) || base <= 0) return;

      const natural = Number.isFinite(currentSize) && currentSize > 0
        ? renderedNatural * (base / currentSize)
        : renderedNatural;
      const minRaw = computed.getPropertyValue(AMOUNT_MIN_FONT_PROPERTY);
      const min = Number.parseFloat(minRaw) || AMOUNT_MIN_FONT_SIZE_FALLBACK;
      const fitted = available * AMOUNT_FIT_SAFETY_FACTOR;
      const target = Math.floor(fitAmountFontSize(fitted, natural, base, min) * 10) / 10;
      // At the minimum type size an extreme value (20 characters at 320px) can still
      // exceed the width; compact only the inline axis by the small remainder rather
      // than clipping or dropping below the readable minimum.
      const unclamped = (base * fitted) / natural;
      const targetScaleX = Math.min(1, Math.max(0.9, unclamped / target));

      setFontSize((current) =>
        current !== undefined && Math.abs(current - target) < AMOUNT_FIT_TOLERANCE_PX
          ? current
          : target,
      );
      setScaleX((current) => (Math.abs(current - targetScaleX) < 0.005 ? current : targetScaleX));
    };

    measure();

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        if (container.clientWidth !== lastWidth) measure();
      });
      observer.observe(container);
    }
    const rootStyleObserver = typeof MutationObserver === "undefined"
      ? undefined
      : new MutationObserver(measure);
    rootStyleObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    let active = true;
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    fonts?.ready?.then(() => {
      if (active) measure();
    }).catch(() => {});

    return () => {
      active = false;
      observer?.disconnect();
      rootStyleObserver?.disconnect();
    };
  }, [text]);

  return { containerRef, sizerRef, fontSize, scaleX };
}

export function useMoneyAssetPricing(assetSymbol: string): MoneyAssetPricing {
  return moneyAssetPricing(assetSymbol, usePresentationRegionId());
}

export function MoneyAmountDisplay({
  amount,
  onAmountChange,
  availableLabel,
  availableAmount,
  availableSuffix,
  assetId,
  assetLabel,
  assetCurrency,
  assetMark,
  assetOptions,
  onAssetChange,
  assetLocked = false,
  chipSet = "none",
  pricing,
  nativeSymbol,
  fiatCurrency,
  initialUnit = "local",
  amountChangeSource = "programmatic",
  assetControl = "body",
}: {
  amount: string;
  onAmountChange?: (value: string, source: MoneyAmountChangeSource) => void;
  availableLabel?: string;
  availableAmount?: string | null;
  availableSuffix?: string;
  assetId?: string;
  assetLabel?: string;
  assetCurrency?: string | null;
  assetMark?: AssetMarkPresentation;
  assetOptions?: ReadonlyArray<MoneyAssetOption>;
  onAssetChange?: (assetId: string) => void;
  assetLocked?: boolean;
  chipSet?: MoneyChipSet;
  pricing: MoneyAssetPricing;
  nativeSymbol: string;
  fiatCurrency?: string;
  initialUnit?: MoneyPrimaryUnit;
  amountChangeSource?: MoneyAmountChangeSource;
  /** The header owns the sole picker when set to `header`. */
  assetControl?: "body" | "header";
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
    <div className="grid justify-items-center gap-3 py-3">
      {assetControl === "body" && assetLabel ? (
        <MoneyAssetPicker
          assetId={assetId}
          assetLabel={assetLabel}
          assetCurrency={assetCurrency}
          assetMark={assetMark}
          assetOptions={assetOptions}
          onAssetChange={onAssetChange}
          locked={assetLocked}
        />
      ) : null}
      {onAmountChange ? (
        <MoneyQuickChips
          chipSet={chipSet}
          localCurrency={pricing.status === "priced" ? pricing.localCurrency : "USD"}
          primaryUnit={primaryUnit}
          availableAmount={maxAmount}
          onSelect={(value) => onAmountChange(value, "programmatic")}
        />
      ) : null}
      <MoneyPrimaryAmount
        amount={amount}
        changeSource={amountChangeSource}
        unit={primaryUnit}
        pricing={pricing}
        fiatCurrency={fiatCurrency}
      />
      <div className="grid justify-items-center gap-1">
        {pricing.status === "priced" ? (
          <MoneyUnitToggle
            secondaryLabel={secondary}
            onToggle={() =>
              setRequestedUnit((current) => (current === "local" ? "native" : "local"))
            }
          />
        ) : null}
        {availableLine ? (
          <div className="text-center text-sm text-muted-foreground">
            <MoneyTicker value={availableLine} reserveDigits={false} />
            {availableSuffix ? ` · ${availableSuffix}` : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MoneyPrimaryAmount({
  amount,
  changeSource,
  unit,
  pricing,
  fiatCurrency,
}: {
  amount: string;
  changeSource: MoneyAmountChangeSource;
  unit: MoneyPrimaryUnit;
  pricing: MoneyAssetPricing;
  fiatCurrency?: string;
}) {
  const text = formatPrimaryAmount(amount, unit, pricing, fiatCurrency);
  const [rendered, setRendered] = useState({ amount, text, animated: true });
  let animated = rendered.animated;
  if (rendered.amount !== amount || rendered.text !== text) {
    animated = shouldAnimatePrimaryAmount(rendered.amount, amount, changeSource);
    setRendered({ amount, text, animated });
  }
  const { containerRef, sizerRef, fontSize, scaleX } = useAutoFitAmountText(text);

  return (
    <>
      <div
        ref={containerRef}
        className="flex w-full max-w-full justify-center whitespace-nowrap px-4 py-3 text-5xl font-semibold leading-none tabular-nums"
        data-primary-amount
        style={fontSize === undefined ? undefined : { fontSize }}
      >
        <MoneyTicker
          value={text}
          animated={animated}
          reserveDigits={false}
          style={scaleX < 1 ? { transform: `scaleX(${scaleX})`, transformOrigin: "center" } : undefined}
        />
      </div>
      <span
        ref={sizerRef}
        className="pointer-events-none absolute invisible whitespace-nowrap text-5xl font-semibold leading-none tabular-nums"
        data-amount-sizer
        aria-hidden="true"
      >
        {text}
      </span>
    </>
  );
}

export type MoneyAssetPickerProps = {
  assetId?: string;
  assetLabel?: string;
  assetCurrency?: string | null;
  assetMark?: AssetMarkPresentation;
  assetOptions?: ReadonlyArray<MoneyAssetOption>;
  onAssetChange?: (assetId: string) => void;
  locked?: boolean;
};

export function MoneyAssetPicker({
  assetId,
  assetLabel,
  assetCurrency,
  assetMark,
  assetOptions,
  onAssetChange,
  locked = false,
}: MoneyAssetPickerProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  if (!assetLabel) return <span />;
  const markCurrency = assetCurrency ?? (assetId === "usdc" ? "USD" : null);
  const options = assetOptions ?? [];
  const canPick = Boolean(!locked && assetId && assetOptions && onAssetChange);

  if (!canPick) {
    return (
      <div role="group" className="flex h-9 max-w-[7.25rem] items-center gap-1 rounded-md border bg-background px-1.5 text-sm font-medium" aria-label={assetLabel}>
        <CurrencyMark
          currency={assetMark?.currency ?? markCurrency}
          symbol={assetMark?.symbol ?? assetLabel}
          src={assetMark?.imageUrl}
          pending={assetMark?.pending}
          presentation="selector"
        />
        <span className="truncate">{assetLabel}</span>
      </div>
    );
  }

  const selected = options.find((option) => option.id === assetId) ?? null;
  return (
    <Combobox
      items={options}
      value={selected}
      open={open}
      autoHighlight
      onOpenChange={setOpen}
      onValueChange={(option) => {
        if (!option) return;
        onAssetChange?.(option.id);
        setOpen(false);
      }}
      itemToStringLabel={(option) => option.currency ?? option.description ?? option.label}
      itemToStringValue={(option) => option.id}
      filter={matchesMoneyAssetOption}
    >
      <ComboboxInput
        aria-label="Asset"
        groupRef={anchorRef}
        placeholder={selected?.currency ?? selected?.description ?? assetLabel}
        className="h-11 w-[7.25rem] max-w-full"
      >
        {selected?.mark ? (
          <InputGroupAddon align="inline-start">
            <CurrencyMark
              currency={selected.mark.currency}
              symbol={selected.mark.symbol}
              src={selected.mark.imageUrl}
              pending={selected.mark.pending}
              presentation="selector"
            />
          </InputGroupAddon>
        ) : null}
      </ComboboxInput>
      <ComboboxContent anchor={anchorRef} className="w-[min(18rem,calc(100vw-2rem))] min-w-[min(18rem,calc(100vw-2rem))]">
        <ComboboxEmpty>No assets found.</ComboboxEmpty>
        <ComboboxList>
          {(option) => (
            <ComboboxItem key={option.id} value={option}>
              {option.mark ? (
                <span className="shrink-0">
                  <CurrencyMark
                    currency={option.mark.currency}
                    symbol={option.mark.symbol}
                    src={option.mark.imageUrl}
                    pending={option.mark.pending}
                    presentation="selector"
                  />
                </span>
              ) : null}
              <span className="flex min-w-0 items-baseline gap-2 truncate">
                <span className="truncate">{option.currency ?? option.description ?? option.label}</span>
                {option.description ? (
                  <span className="shrink-0 text-muted-foreground">{option.label}</span>
                ) : null}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
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
    <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Quick amounts">
      {chipSet === "quick-local" ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={quickDisabled}
            onClick={() => onSelect(clampDecimal("10", availableAmount))}
          >
            <MoneyTicker value={formatChipLabel(10, localCurrency)} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={quickDisabled}
            onClick={() => onSelect(clampDecimal("25", availableAmount))}
          >
            <MoneyTicker value={formatChipLabel(25, localCurrency)} />
          </Button>
        </>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        disabled={!maxEnabled}
        onClick={() => {
          if (availableAmount) onSelect(availableAmount);
        }}
      >
        Max
      </Button>
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
    <Button
      variant="outline"
      size="sm"
      onClick={onToggle}
      aria-label={`Show ${secondaryLabel} as the primary amount`}
    >
      <ArrowDownUp className="size-4" aria-hidden="true" />
      <MoneyTicker value={secondaryLabel} />
    </Button>
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
  onChange: (value: string, source: MoneyAmountChangeSource) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Amount keypad">
      {KEYS.map((key) => (
        <Button
          key={key}
          className="h-14"
          variant="ghost"
          disabled={disabled}
          aria-label={key === "backspace" ? "Delete last digit" : key === "." ? "Decimal point" : key}
          onClick={() => {
            const next = applyNumpadKey(value, key, maxDecimals);
            if (next === value) return;
            onChange(next, "keypad");
            triggerKeyHaptic();
          }}
        >
          {key === "backspace" ? (
            <Delete size={22} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <span className="text-xl tabular-nums">{key}</span>
          )}
        </Button>
      ))}
    </div>
  );
}
