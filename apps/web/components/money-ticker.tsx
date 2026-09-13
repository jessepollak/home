"use client";

import NumberFlow, { usePrefersReducedMotion } from "@number-flow/react";
import {
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
} from "react";

const asciiDigitValues = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
} as const;

type AsciiDigit = keyof typeof asciiDigitValues;

export type MoneyTickerParts = {
  prefix: string;
  numeric: string;
  suffix: string;
};

export type MoneyTickerProps = Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
> & {
  /** An already-formatted display string. MoneyTicker never parses the amount as a number. */
  value: string;
  /** Disables transitions while preserving the exact formatted value. */
  animated?: boolean;
  /** Keeps the ticker's widest rendered character count to prevent balance rows from shifting. */
  reserveDigits?: boolean;
};

/**
 * Splits an already-formatted value around its first and last ASCII digits.
 * Currency symbols, signs, grouping, decimal separators, spaces, and units stay
 * byte-for-byte anchored while only individual display digits are animated.
 */
export function splitMoneyTickerValue(value: string): MoneyTickerParts {
  const characters = Array.from(value);
  const firstDigit = characters.findIndex(isAsciiDigit);
  if (firstDigit < 0) return { prefix: value, numeric: "", suffix: "" };

  let lastDigit = characters.length - 1;
  while (lastDigit > firstDigit && !isAsciiDigit(characters[lastDigit]!)) {
    lastDigit -= 1;
  }

  return {
    prefix: characters.slice(0, firstDigit).join(""),
    numeric: characters.slice(firstDigit, lastDigit + 1).join(""),
    suffix: characters.slice(lastDigit + 1).join(""),
  };
}

export function MoneyTicker({
  value,
  animated = true,
  reserveDigits = true,
  className,
  style,
  ...props
}: MoneyTickerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const parts = splitMoneyTickerValue(value);
  const characters = Array.from(parts.numeric);
  const digitCount = characters.filter(isAsciiDigit).length;
  const characterCount = Array.from(value).length;
  const [reservedCharacters, setReservedCharacters] = useState(characterCount);

  if (reserveDigits && characterCount > reservedCharacters) {
    setReservedCharacters(characterCount);
  }

  let digitIndex = 0;
  const tickerStyle = {
    ...style,
    minInlineSize: `${reserveDigits ? reservedCharacters : characterCount}ch`,
  } satisfies CSSProperties;

  return (
    <span
      {...props}
      className={[
        "relative inline-flex w-fit max-w-full justify-end whitespace-nowrap font-mono tabular-nums text-inherit",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={tickerStyle}
      role="img"
      aria-label={props["aria-label"] ?? value}
      data-slot="money-ticker"
      data-reserve-digits={reserveDigits ? "true" : "false"}
      data-reserved-digits={digitCount}
    >
      <span
        className="pointer-events-none absolute inset-0 overflow-hidden opacity-0"
        aria-hidden="true"
      >
        {value}
      </span>
      <span
        className="inline-flex items-baseline"
        aria-hidden="true"
        data-slot="money-ticker-track"
      >
        {parts.prefix ? (
          <span className="whitespace-pre">{parts.prefix}</span>
        ) : null}
        {characters.map((character, index) => {
          if (!isAsciiDigit(character)) {
            return (
              <span className="whitespace-pre" key={`literal-${index}-${character}`}>
                {character}
              </span>
            );
          }

          const positionFromRight = digitCount - digitIndex;
          digitIndex += 1;
          return (
            <NumberFlow
              aria-hidden="true"
              animated={animated && !reducedMotion}
              className="inline-block w-[1ch] flex-[0_0_1ch] text-center [--number-flow-mask-width:0px]"
              format={{ useGrouping: false, maximumFractionDigits: 0 }}
              isolate={false}
              key={`digit-${positionFromRight}`}
              value={asciiDigitValues[character]}
            />
          );
        })}
        {parts.suffix ? (
          <span className="whitespace-pre">{parts.suffix}</span>
        ) : null}
      </span>
    </span>
  );
}

function isAsciiDigit(value: string): value is AsciiDigit {
  return value in asciiDigitValues;
}
