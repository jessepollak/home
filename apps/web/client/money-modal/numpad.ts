export type NumpadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "backspace";

const MAX_WHOLE_DIGITS = 12;

export function applyNumpadKey(
  current: string,
  key: NumpadKey,
  maxDecimals: number,
): string {
  if (key === "backspace") {
    return current.slice(0, -1);
  }

  if (key === ".") {
    if (maxDecimals <= 0 || current.includes(".")) return current;
    return current === "" ? "0." : `${current}.`;
  }

  if (current === "0") return key;
  if (current === "") return key === "0" ? "0" : key;

  if (current.includes(".")) {
    const fraction = current.split(".")[1] ?? "";
    if (fraction.length >= maxDecimals) return current;
    return `${current}${key}`;
  }

  if (current.length >= MAX_WHOLE_DIGITS) return current;
  return `${current}${key}`;
}

export function isPositiveDecimalAmount(value: string): boolean {
  const normalized = value.trim().replace(/\.$/, "");
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(normalized)) return false;
  return /[1-9]/.test(normalized);
}
