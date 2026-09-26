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
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { ArrowDownUp } from "lucide-react";
import { CurrencyMark } from "@/components/currency-mark";
import { InputGroupAddon } from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import type { AssetMarkPresentation } from "@/client/asset-mark/presentation";
import { usePresentationRegionId } from "@/client/invest/presentation-quote";
import { decimalSeparatorForLocale, normalizeTypedAmount, parsePastedAmount } from "./amount-input";
import {
  amountExceedsCeiling,
  clampDecimal,
  formatAvailableDecimal,
  formatAvailableLine,
  formatChipLabel,
  formatPrimaryAmount,
  formatPrimaryAmountUnit,
  formatSecondaryAmount,
  isAvailablePositive,
  isIdentityPricing,
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
const AMOUNT_FIT_SAFETY_FACTOR = 0.97;

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

export function useAutoFitAmountText<T extends HTMLElement = HTMLLabelElement>(
  text: string,
  options: { minRem?: number } = {},
) {
  const { minRem } = options;
  const containerRef = useRef<T>(null);
  const sizerRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState<number | undefined>(undefined);
  const [overflows, setOverflows] = useState(false);
  const lastWidthRef = useRef(-1);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const sizer = sizerRef.current;
    if (!container || !sizer) return;

    lastWidthRef.current = container.clientWidth;
    const computed = window.getComputedStyle(container);
    const horizontalPadding =
      (Number.parseFloat(computed.paddingLeft) || 0)
      + (Number.parseFloat(computed.paddingRight) || 0);
    const available = container.clientWidth - horizontalPadding;
    const base = Number.parseFloat(window.getComputedStyle(sizer).fontSize);
    const natural = sizer.getBoundingClientRect().width;
    if (available <= 0 || natural <= 0 || !Number.isFinite(base) || base <= 0) return;
    const minRaw = computed.getPropertyValue(AMOUNT_MIN_FONT_PROPERTY);
    const min = minRem === undefined
      ? Number.parseFloat(minRaw) || AMOUNT_MIN_FONT_SIZE_FALLBACK
      : minRem * Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    const fitted = available * AMOUNT_FIT_SAFETY_FACTOR;
    const rounded = Math.floor(fitAmountFontSize(fitted, natural, base, min) * 10) / 10;
    const target = minRem === undefined ? rounded : Math.max(min, rounded);

    setOverflows(natural * min / base > available);
    setFontSize((current) =>
      current !== undefined
        && Math.abs(current - target) < AMOUNT_FIT_TOLERANCE_PX
        && (minRem === undefined || current >= min)
        ? current
        : target,
    );
  }, [minRem]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const sizer = sizerRef.current;
    if (!container || !sizer) return;

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        if (container.clientWidth !== lastWidthRef.current) measure();
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
  }, [measure]);

  useLayoutEffect(() => {
    measure();
  }, [measure, text]);

  return { containerRef, sizerRef, fontSize, overflows };
}

export function useMoneyAssetPricing(assetSymbol: string): MoneyAssetPricing {
  return moneyAssetPricing(assetSymbol, usePresentationRegionId());
}

export function MoneyAmountDisplay({
  amount,
  onAmountChange,
  maxDecimals,
  overAvailable = false,
  onSubmit,
  disabled = false,
  autoFocus = true,
  children,
  availableLabel,
  availableAmount,
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
  assetControl = "body",
}: {
  amount: string;
  onAmountChange?: (value: string) => void;
  maxDecimals: number;
  overAvailable?: boolean;
  onSubmit?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  children?: ReactNode;
  availableLabel?: string;
  availableAmount?: string | null;
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
  assetControl?: "body" | "header";
}) {
  const [requestedUnit, setRequestedUnit] = useState<MoneyPrimaryUnit>(initialUnit);
  const lastAssetId = useRef(assetId);
  const availableId = useId();
  const primaryUnit = isIdentityPricing(pricing)
    ? resolvePrimaryUnit(pricing, requestedUnit)
    : "native";
  const maxAmount = availableAmount ?? parseAvailableDecimal(availableLabel ?? "");
  const availableLine = formatAvailableLine(availableLabel, primaryUnit, pricing, nativeSymbol);
  const labelAmount = parseAvailableDecimal(availableLabel ?? "");
  const ceilingDiffers = Boolean(maxAmount && labelAmount && (amountExceedsCeiling(labelAmount, maxAmount) || amountExceedsCeiling(maxAmount, labelAmount)));
  const ceilingLine = ceilingDiffers && maxAmount ? formatAvailableDecimal(maxAmount, primaryUnit, pricing, nativeSymbol) : undefined;
  const secondary = formatSecondaryAmount(amount, primaryUnit, pricing, nativeSymbol);

  useEffect(() => {
    if (lastAssetId.current === assetId) return;
    lastAssetId.current = assetId;
    setRequestedUnit("local");
  }, [assetId]);

  return (
    <div className="flex min-h-full w-full flex-col items-center gap-3 py-3">
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
      <MoneyPrimaryAmount
        amount={amount}
        onAmountChange={onAmountChange}
        maxDecimals={maxDecimals}
        onSubmit={onSubmit}
        disabled={disabled}
        autoFocus={autoFocus}
        focusKey={assetId}
        availableId={availableLine ? availableId : undefined}
        overAvailable={overAvailable}
        unit={primaryUnit}
        pricing={pricing}
        fiatCurrency={fiatCurrency}
        nativeSymbol={nativeSymbol}
      />
      {availableLine ? (
        <p id={availableId} aria-live="polite" className={`text-center text-sm ${overAvailable ? "text-destructive" : "text-muted-foreground"}`}>
          {overAvailable ? `Only ${ceilingLine ?? availableLine}` : availableLine}
        </p>
      ) : null}
      {isIdentityPricing(pricing) ? (
        <MoneyUnitToggle
          secondaryLabel={secondary}
          onToggle={() => setRequestedUnit((current) => (current === "local" ? "native" : "local"))}
        />
      ) : null}
      {children}
      {onAmountChange && chipSet !== "none" ? (
        <div className="mt-auto">
          <MoneyQuickChips
            chipSet={chipSet}
            localCurrency={pricing.status === "priced" ? pricing.localCurrency : "USD"}
            primaryUnit={primaryUnit}
            availableAmount={maxAmount}
            onSelect={onAmountChange}
          />
        </div>
      ) : null}
    </div>
  );
}

export function MoneyPrimaryAmount({
  amount,
  onAmountChange,
  maxDecimals,
  onSubmit,
  disabled = false,
  autoFocus = true,
  focusKey,
  availableId,
  overAvailable = false,
  unit,
  pricing,
  fiatCurrency,
  nativeSymbol,
}: {
  amount: string;
  onAmountChange?: (value: string) => void;
  maxDecimals: number;
  onSubmit?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  focusKey?: string;
  availableId?: string;
  overAvailable?: boolean;
  unit: MoneyPrimaryUnit;
  pricing: MoneyAssetPricing;
  fiatCurrency?: string;
  nativeSymbol: string;
}) {
  const text = formatPrimaryAmount(amount, unit, pricing, fiatCurrency, nativeSymbol);
  const figure = amount === "" ? "0" : amount;
  const figureIndex = text.indexOf(figure);
  const prefix = text.slice(0, figureIndex);
  const suffix = text.slice(figureIndex + figure.length);
  const unitName = formatPrimaryAmountUnit(unit, pricing, fiatCurrency, nativeSymbol);
  const unitId = useId();
  const describedBy = [unitName ? unitId : undefined, availableId].filter(Boolean).join(" ") || undefined;
  const { containerRef, sizerRef, fontSize } = useAutoFitAmountText(text);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousSelection = useRef({ start: 0, end: 0 });
  const nextCaret = useRef<number | null>(null);
  const handledInputEvent = useRef<Event | null>(null);
  const focusOnMount = useRef(autoFocus && Boolean(onAmountChange) && !disabled);

  useEffect(() => {
    if (focusOnMount.current) inputRef.current?.focus({ preventScroll: true });
  }, []);

  const lastFocusKey = useRef(focusKey);
  useEffect(() => {
    if (lastFocusKey.current === focusKey) return;
    lastFocusKey.current = focusKey;
    if (onAmountChange && !disabled) inputRef.current?.focus({ preventScroll: true });
  }, [disabled, focusKey, onAmountChange]);

  useLayoutEffect(() => {
    if (nextCaret.current === null) return;
    inputRef.current?.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  }, [amount]);

  const rememberSelection = () => {
    const input = inputRef.current;
    if (input) previousSelection.current = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
  };

  const handleInputEvent = (event: SyntheticEvent<HTMLInputElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (handledInputEvent.current === nativeEvent || nativeEvent.isComposing) return;
    handledInputEvent.current = nativeEvent;
    const input = event.currentTarget;
    applyEdit(input.value, input.selectionStart ?? input.value.length, input);
  };

  const applyEdit = (raw: string, rawCaret: number, input: HTMLInputElement) => {
    const result = normalizeTypedAmount(raw, maxDecimals);
    if (!result.ok) {
      input.value = amount;
      input.setSelectionRange(previousSelection.current.start, previousSelection.current.end);
      return;
    }
    const prefixResult = normalizeTypedAmount(raw.slice(0, rawCaret), maxDecimals);
    const caret = prefixResult.ok ? prefixResult.value.length : Math.min(rawCaret, result.value.length);
    nextCaret.current = result.value === amount ? null : caret;
    input.value = result.value;
    input.setSelectionRange(caret, caret);
    previousSelection.current = { start: caret, end: caret };
    onAmountChange?.(result.value);
  };

  return (
    <>
      <label
        ref={containerRef}
        dir="ltr"
        className="flex w-full min-w-0 max-w-full shrink-0 cursor-text items-center justify-center overflow-hidden whitespace-nowrap px-4 py-3 text-5xl font-semibold leading-none tabular-nums"
        data-primary-amount
        style={fontSize === undefined ? undefined : { fontSize }}
      >
        {onAmountChange ? (
          <>
            {prefix ? <span aria-hidden="true" className={`whitespace-pre ${amount === "" ? "text-muted-foreground" : ""}`.trim()}>{prefix}</span> : null}
            <span className="relative inline-block min-w-[1ch] max-w-full">
              <span className="invisible whitespace-pre pe-0.5" aria-hidden="true">{figure}</span>
              <Input
                ref={inputRef}
                variant="amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Amount"
                aria-describedby={describedBy}
                aria-invalid={overAvailable || undefined}
                data-money-amount-input
                className="absolute inset-0 size-full min-w-0"
                value={amount}
                placeholder="0"
                disabled={disabled}
                onSelect={rememberSelection}
                onBeforeInput={rememberSelection}
                onKeyDown={(event) => {
                  rememberSelection();
                  if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                    event.preventDefault();
                    onSubmit?.();
                  }
                }}
                onInput={handleInputEvent}
                onChange={handleInputEvent}
                onCompositionEnd={(event) => {
                  const input = event.currentTarget;
                  applyEdit(input.value, input.selectionStart ?? input.value.length, input);
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  const input = event.currentTarget;
                  const start = input.selectionStart ?? amount.length;
                  const end = input.selectionEnd ?? start;
                  previousSelection.current = { start, end };
                  const parsed = parsePastedAmount(event.clipboardData.getData("text"), decimalSeparatorForLocale(typeof navigator === "undefined" ? undefined : navigator.language));
                  if (!parsed.ok) return;
                  const raw = `${amount.slice(0, start)}${parsed.value}${amount.slice(end)}`;
                  applyEdit(raw, start + parsed.value.length, input);
                }}
              />
            </span>
            {suffix ? <span aria-hidden="true" className={`whitespace-pre ${amount === "" ? "text-muted-foreground" : ""}`.trim()}>{suffix}</span> : null}
          </>
        ) : <span>{text}</span>}
      </label>
      {onAmountChange && unitName ? <span id={unitId} className="sr-only">{`Currency: ${unitName}`}</span> : null}
      <span
        ref={sizerRef}
        className="pointer-events-none absolute invisible whitespace-nowrap text-5xl font-semibold leading-none tabular-nums"
        data-amount-sizer
        aria-hidden="true"
      >{text}</span>
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
          assetKey={assetMark?.assetKey}
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
              assetKey={selected.mark.assetKey}
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
                    assetKey={option.mark.assetKey}
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
            className="h-11 md:pointer-fine:h-7"
            disabled={quickDisabled}
            onClick={() => onSelect(clampDecimal("10", availableAmount))}
          >
            <MoneyTicker value={formatChipLabel(10, localCurrency)} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:pointer-fine:h-7"
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
        className="h-11 md:pointer-fine:h-7"
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
      className="h-11 md:pointer-fine:h-7"
      onClick={onToggle}
      aria-label={`Show ${secondaryLabel} as the primary amount`}
    >
      <ArrowDownUp className="size-4" aria-hidden="true" />
      <MoneyTicker value={secondaryLabel} />
    </Button>
  );
}
