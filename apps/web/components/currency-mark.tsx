import styles from "./currency-mark.module.css";

const MARKS: Record<string, { className: string; label: string }> = {
  USD: { className: styles.usd, label: "US dollar" },
  BRL: { className: styles.brl, label: "Brazilian real" },
};

type CurrencyMarkProps = {
  currency?: string | null;
  symbol?: string | null;
};

export function CurrencyMark({ currency, symbol }: CurrencyMarkProps) {
  const code = currency?.toUpperCase() ?? "";
  const mark = MARKS[code];
  if (code === "BRL") {
    return (
      <span className={`${styles.mark} ${styles.brl}`} aria-hidden="true">
        <BrazilMark />
      </span>
    );
  }
  if (mark) {
    return (
      <span className={`${styles.mark} ${mark.className}`} aria-hidden="true">
        $
      </span>
    );
  }

  const glyph = (symbol ?? currency ?? "?").slice(0, 2);
  return (
    <span className={`${styles.mark} ${styles.fallback}`} aria-hidden="true">
      {glyph}
    </span>
  );
}

function BrazilMark() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="16" fill="#009B3A" />
      <path d="M16 6.2 26.4 16 16 25.8 5.6 16Z" fill="#FEDD00" />
      <circle cx="16" cy="16" r="5.4" fill="#002776" />
    </svg>
  );
}
