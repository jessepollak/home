"use client";

import NumberFlow from "@number-flow/react";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MoneyMotionContext = createContext<boolean | undefined>(undefined);

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
  value: string;
  animated?: boolean;
  reserveDigits?: boolean;
  align?: "start" | "end";
};

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

export function moneyTickerAnimationsEnabled(animated: boolean, reducedMotion: boolean): boolean {
  return animated && !reducedMotion;
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function reducedMotionSnapshot(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function useReducedMotion(): boolean {
  const systemPreference = useSyncExternalStore(subscribeToReducedMotion, reducedMotionSnapshot, () => false);
  return useContext(MoneyMotionContext) ?? systemPreference;
}

export function MoneyMotionProvider({
  reducedMotion,
  children,
}: {
  reducedMotion?: boolean;
  children?: ReactNode;
}) {
  return (
    <MoneyMotionContext.Provider value={reducedMotion}>
      {children}
    </MoneyMotionContext.Provider>
  );
}

export function MoneyTicker({
  value,
  animated = true,
  reserveDigits = true,
  align = "end",
  className,
  style,
  ...props
}: MoneyTickerProps) {
  const reducedMotion = useReducedMotion();
  const parts = splitMoneyTickerValue(value);
  const characters = Array.from(parts.numeric);
  const digitCount = characters.filter(isAsciiDigit).length;
  const characterCount = Array.from(value).length;
  const [reservedCharacters, setReservedCharacters] = useState(characterCount);
  const reservesWidth = align === "end" && reserveDigits;

  if (reservesWidth && characterCount > reservedCharacters) {
    setReservedCharacters(characterCount);
  }

  let digitIndex = 0;
  const tickerStyle = {
    ...style,
    minInlineSize: reservesWidth ? `${reservedCharacters}ch` : undefined,
  } satisfies CSSProperties;

  return (
    <span
      {...props}
      className={[
        "relative inline-flex w-fit max-w-full whitespace-nowrap tabular-nums text-inherit",
        align === "start" ? "justify-start" : "justify-end",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={tickerStyle}
      role="img"
      aria-label={props["aria-label"] ?? value}
      data-slot="money-ticker"
      data-animated={moneyTickerAnimationsEnabled(animated, reducedMotion) ? "true" : "false"}
      data-align={align}
      data-reserve-digits={reservesWidth ? "true" : "false"}
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
              animated={moneyTickerAnimationsEnabled(animated, reducedMotion)}
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
