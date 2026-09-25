export const MAX_AMOUNT_WHOLE_DIGITS = 12;

export type AmountEditResult = { ok: true; value: string } | { ok: false };

function normalizeDigits(whole: string, fraction: string | undefined): string {
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || (fraction === undefined ? "" : "0");
  return fraction === undefined ? normalizedWhole : `${normalizedWhole}.${fraction}`;
}

export function normalizeTypedAmount(raw: string, maxDecimals: number): AmountEditResult {
  if (!/^[0-9]*[.,]?[0-9]*$/.test(raw)) return { ok: false };
  const separatorIndex = raw.search(/[.,]/);
  const whole = separatorIndex === -1 ? raw : raw.slice(0, separatorIndex);
  const fraction = separatorIndex === -1 ? undefined : raw.slice(separatorIndex + 1);
  if (fraction !== undefined && (maxDecimals <= 0 || fraction.length > maxDecimals)) {
    return { ok: false };
  }
  const value = normalizeDigits(whole, fraction);
  if (value.split(".")[0].length > MAX_AMOUNT_WHOLE_DIGITS) return { ok: false };
  return { ok: true, value };
}

export function parsePastedAmount(text: string, localeDecimal: "." | ","): AmountEditResult {
  const stripped = text.trim().replace(/^\p{Sc}|\p{Sc}$/u, "").trim();
  if (!/^[0-9., '’\u00a0\u202f\u2009]*$/.test(stripped)) return { ok: false };

  const lastPoint = stripped.lastIndexOf(".");
  const lastComma = stripped.lastIndexOf(",");
  const pointCount = stripped.split(".").length - 1;
  const commaCount = stripped.split(",").length - 1;
  let decimal: "." | "," | undefined;

  if (pointCount && commaCount) {
    decimal = lastPoint > lastComma ? "." : ",";
    if ((decimal === "." ? pointCount : commaCount) !== 1) return { ok: false };
  } else {
    const separator = pointCount ? "." : ",";
    const count = pointCount || commaCount;
    if (count === 1) {
      const before = stripped.slice(0, separator === "." ? lastPoint : lastComma);
      const after = stripped.slice(before.length + 1);
      const isGrouping =
        separator !== localeDecimal &&
        /^[0-9]{1,3}$/.test(before) &&
        /[1-9]/.test(before) &&
        /^[0-9]{3}$/.test(after);
      if (!isGrouping) decimal = separator;
    }
  }

  const index = decimal === undefined ? -1 : stripped.lastIndexOf(decimal);
  const whole = index === -1 ? stripped : stripped.slice(0, index);
  const fraction = index === -1 ? undefined : stripped.slice(index + 1);
  if (fraction !== undefined && !/^[0-9]*$/.test(fraction)) return { ok: false };

  const normalizedWhole = whole.replace(/[ \u00a0\u202f\u2009]/gu, " ").replace(/’/gu, "'");
  const groups = normalizedWhole.match(/[., ']/g);
  if (groups) {
    const chunks = normalizedWhole.split(groups[0]);
    if (groups.some((group) => group !== groups[0]) ||
      !/^[0-9]{1,3}$/.test(chunks[0]) ||
      chunks.slice(1).some((chunk) => !/^[0-9]{3}$/.test(chunk))) return { ok: false };
  }
  return { ok: true, value: normalizeDigits(normalizedWhole.replace(/[., ']/g, ""), fraction) };
}

export function decimalSeparatorForLocale(locale: string | undefined): "." | "," {
  if (!locale) return ".";
  try {
    if (Intl.NumberFormat.supportedLocalesOf(locale).length === 0) return ".";
    const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value; // oxlint-disable-line home/no-local-formatting -- device-locale input parsing, not number presentation
    return separator === "," ? "," : ".";
  } catch {
    return ".";
  }
}

export function isPositiveDecimalAmount(value: string): boolean {
  const normalized = value.trim().replace(/\.$/, "");
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(normalized)) return false;
  return /[1-9]/.test(normalized);
}
