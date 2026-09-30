import type { Rgba } from "./contrast";

export type ThemeName = "light" | "dark";
export type ThemeValues = Record<ThemeName, Record<string, string>>;

function sheetText(sheet: CSSStyleSheet): string {
  try {
    return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
  } catch {
    return "";
  }
}

export function readThemeValues(names: string[]): ThemeValues {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: "fixed", width: "0", height: "0", border: "0", visibility: "hidden" });
  document.body.append(frame);
  try {
    const doc = frame.contentDocument!;
    const style = doc.createElement("style");
    style.textContent = Array.from(document.styleSheets, sheetText).join("\n");
    doc.head.append(style);
    const read = (theme: ThemeName) => {
      doc.documentElement.classList.toggle("dark", theme === "dark");
      const computed = frame.contentWindow!.getComputedStyle(doc.documentElement);
      return Object.fromEntries(names.map((name) => [name, computed.getPropertyValue(`--${name}`).trim()]));
    };
    return { light: read("light"), dark: read("dark") };
  } finally {
    frame.remove();
  }
}

let context: CanvasRenderingContext2D | null = null;

export function toRgba(value: string): Rgba | null {
  if (!value || !CSS.supports("color", value)) return null;
  context ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 })
    .getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: a / 255 };
}

export function measure(values: Record<string, string>, property: "width" | "fontSize" | "lineHeight" = "width") {
  const probe = document.createElement("div");
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", pointerEvents: "none", fontSize: "16px" });
  document.body.append(probe);
  try {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => {
      probe.style[property] = "";
      probe.style[property] = value;
      const computed = getComputedStyle(probe)[property];
      return [key, probe.style[property] ? Number.parseFloat(computed) : Number.NaN];
    }));
  } finally {
    probe.remove();
  }
}

export function rootProperties(names: string[]): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  return Object.fromEntries(names.map((name) => [name, computed.getPropertyValue(`--${name}`).trim()]));
}
