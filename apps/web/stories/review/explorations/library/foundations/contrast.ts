export type Rgba = { r: number; g: number; b: number; a: number };

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function composite(top: Rgba, bottom: Rgba): Rgba {
  const base = bottom.a < 1 ? composite(bottom, { r: 255, g: 255, b: 255, a: 1 }) : bottom;
  const mix = (front: number, back: number) => front * top.a + back * (1 - top.a);
  return { r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b), a: 1 };
}

export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const back = background.a < 1 ? composite(background, { r: 255, g: 255, b: 255, a: 1 }) : background;
  const front = foreground.a < 1 ? composite(foreground, back) : foreground;
  const [light, dark] = [relativeLuminance(front), relativeLuminance(back)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

export function toHex({ r, g, b, a }: Rgba): string {
  const byte = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a * 255) : ""}`;
}
