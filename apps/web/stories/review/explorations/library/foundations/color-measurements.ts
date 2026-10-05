import { countLabel } from "../catalog";
import { composite, contrastRatio, toHex, type Rgba } from "./contrast";
import { toRgba } from "./probe";
import type { ColorToken } from "./tokens";

export type ColorMeasurement = {
  status: "measured" | "unavailable";
  value: string;
  hex: string | null;
  checks: { label: string; ratio: number }[];
  verdict: "pass" | "fail" | null;
};

export function measureColor(token: ColorToken, values: Record<string, string>, convert: (value: string) => Rgba | null = toRgba): ColorMeasurement {
  const value = values[token.name] ?? "";
  const unavailable: ColorMeasurement = { status: "unavailable", value, hex: null, checks: [], verdict: null };
  try {
    if (token.pattern) return value ? { ...unavailable, status: "measured" } : unavailable;
    const color = convert(value);
    const card = convert(values.card ?? "");
    const page = convert(values.muted ?? "");
    if (!color || !card || !page) return unavailable;
    const checks = [{ label: "Card", ratio: contrastRatio(color, card) }, { label: "Page", ratio: contrastRatio(color, page) }];
    const measured: ColorMeasurement = { status: "measured", value, hex: toHex(color), checks, verdict: null };
    const rule = token.rule;
    if (rule.use !== "text" && rule.use !== "graphic") return measured;
    let judged = checks;
    if (rule.against !== "surfaces") {
      const pair = convert(values[rule.against.pair] ?? "");
      if (!pair) return unavailable;
      judged = [{ label: `On --${rule.against.pair}`, ratio: contrastRatio(color, composite(pair, page)) }];
      checks.unshift(...judged);
    }
    return { ...measured, verdict: judged.every((check) => check.ratio >= rule.min) ? "pass" : "fail" };
  } catch {
    return unavailable;
  }
}

export function measurementSummary(measurements: ColorMeasurement[], failedNames: string[] = []): string {
  const failed = measurements.filter((measurement) => measurement.verdict === "fail").length;
  const unavailable = measurements.filter((measurement) => measurement.status === "unavailable").length;
  const judged = measurements.filter((measurement) => measurement.verdict !== null).length;
  const names = failedNames.length ? ` (${failedNames.join(", ")})` : "";
  const result = failed ? `${failed} below threshold${names}` : judged ? "all measured checks pass" : "no contrast checks measured";
  return unavailable ? `${result} · ${countLabel(unavailable, "unmeasured token")}` : result;
}
