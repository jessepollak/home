import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const globals = readFileSync(resolve(import.meta.dir, "globals.css"), "utf8");
const invest = readFileSync(
  resolve(import.meta.dir, "../features/invest/invest-experience.module.css"),
  "utf8",
);
const chart = readFileSync(
  resolve(import.meta.dir, "../features/invest/price-chart.tsx"),
  "utf8",
);

describe("Direction 1 — Vercel Editorial tokens", () => {
  test("locks the signed Home + Invest palette", () => {
    expect(globals).toContain("--home-ink: #0a0b0d");
    expect(globals).toContain("--home-muted: #5b6270");
    expect(globals).toContain("--home-white: #ffffff");
    expect(globals).toContain("--home-canvas: #f7f8fa");
    expect(globals).toContain("--home-hairline: #e6e8ec");
    expect(globals).toContain("--home-blue: #0052ff");
    expect(globals).toContain("--control-radius: 8px");
    expect(globals).toContain("--panel-radius: 12px");
  });

  test("keeps motion optical and reduced-motion instant", () => {
    expect(globals).toContain("--motion-tab: 180ms");
    expect(globals).toContain("--motion-chip: 120ms");
    expect(globals).toContain("--motion-press: 100ms");
    expect(globals).toContain("--motion-tab: 0ms");
    expect(globals).toContain("--motion-chip: 0ms");
    expect(globals).toContain("--motion-press: 0ms");
  });

  test("lets meme Δ% green/red beat muted .quote small", () => {
    expect(invest).toContain(".quote small.changeUp");
    expect(invest).toContain(".quote small.changeDown");
    expect(invest).toContain("color: #0f8a4b");
    expect(invest).toContain("color: #c3372a");
    expect(invest.indexOf(".quote small")).toBeLessThan(
      invest.indexOf(".quote small.changeUp"),
    );
  });

  test("keeps the Invest Liveline wash on Direction 1 blue", () => {
    expect(chart).toContain('const LINE_COLOR = "#0052ff"');
    expect(chart).toContain('theme="light"');
    expect(chart).toContain("fill");
    expect(invest).toContain("background: var(--home-canvas)");
  });
});
