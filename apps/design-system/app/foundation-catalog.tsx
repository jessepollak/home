"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Heading, IconButton, Text, type TextStyle } from "@home/ui";
import { ArrowRightIcon, CheckIcon, PlusIcon, XIcon } from "@home/ui/icons";

const textStyles: TextStyle[] = [
  "amount", "page-title", "sheet-title", "section-title", "row-label", "row-value",
  "body", "input", "control", "secondary", "metadata",
];

// Already-formatted display fixtures only. No balances, math, or domain status.
const amounts = [
  "$1,234,567,890.12", "€1.234.567,89", "£987,654.32", "¥123,456,789",
  "₹12,34,56,789.00", "₦1,234,567.89", "R$ 1.234.567,89", "₩123,456,789",
];

export function FoundationCatalog() {
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [textScale, setTextScale] = useState("100");
  const [width, setWidth] = useState("fluid");
  const [activations, setActivations] = useState(0);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.style.fontSize = textScale === "200" ? "200%" : "";
    return () => { document.documentElement.style.fontSize = ""; };
  }, [textScale]);

  const state = { disabled, loading, "aria-pressed": pressed };
  const activate = () => setActivations((count) => count + 1);

  return (
    <>
      <fieldset className="catalog-controls">
        <legend><Text as="span" textStyle="section-title">Specimen controls</Text></legend>
        <div className="catalog-control-grid">
          <label><input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} /> Disabled</label>
          <label><input type="checkbox" checked={loading} onChange={(event) => setLoading(event.target.checked)} /> Loading</label>
          <label><input type="checkbox" checked={pressed} onChange={(event) => setPressed(event.target.checked)} /> Pressed</label>
          <label><input type="checkbox" checked={fallback} onChange={(event) => setFallback(event.target.checked)} /> System font fallback</label>
          <label className="catalog-select-label">Text size
            <select value={textScale} onChange={(event) => setTextScale(event.target.value)}>
              <option value="100">100%</option><option value="200">200%</option>
            </select>
          </label>
          <label className="catalog-select-label">Specimen width
            <select value={width} onChange={(event) => setWidth(event.target.value)}>
              <option value="fluid">Available width</option><option value="320">320px</option>
              <option value="390">390px</option><option value="desktop">Desktop (960px max)</option>
            </select>
          </label>
        </div>
        <Text textStyle="secondary" tone="muted">Tab to inspect focus. Motion follows your device’s reduced-motion preference.</Text>
        <Text textStyle="secondary" className="catalog-motion-default">Motion: standard</Text>
        <Text textStyle="secondary" className="catalog-motion-reduced">Motion: reduced</Text>
        <Button variant="quiet" disabled={disabled || loading} onClick={() => primaryRef.current?.focus({ focusVisible: true } as FocusOptions)}>Focus primary</Button>
      </fieldset>

      <div className="catalog-specimens" data-width={width} data-font={fallback ? "fallback" : "dm-sans-and-mono"}>
        <section className="catalog-section bg-home-ui-surface" aria-labelledby="typography-title">
          <Heading id="typography-title" level={2} textStyle="section-title">Typography</Heading>
          <Text textStyle="secondary" tone="muted">DM Sans for UI; DM Mono Medium for amount and row-value. Each role sample is a paragraph.</Text>
          <dl className="catalog-type-list">
            {textStyles.map((textStyle) => (
              <div key={textStyle} className="catalog-type-sample">
                <dt><Text as="span" textStyle="metadata" tone="muted">{textStyle}</Text></dt>
                <dd><Text textStyle={textStyle}>{textStyle === "amount" || textStyle === "row-value" ? "$1,234,567,890.12" : "The things that matter, all in one place."}</Text></dd>
              </div>
            ))}
          </dl>
          <Heading level={3} textStyle="body">A semantic h3 with body styling</Heading>
          <Text as="em">DM Sans italic, with a local font file.</Text>
          <Heading level={3} textStyle="body">Numeric alignment</Heading>
          <Text textStyle="secondary" tone="muted">DM Mono has equal-width ASCII digits by design. DM Sans is proportional and has no tabular-number feature.</Text>
          {(["amount", "row-value", "body"] as const).map((role) => (
            <div key={role} className="catalog-type-sample">
              <Text textStyle="metadata" tone="muted">{role} — {role === "body" ? "DM Sans" : "DM Mono Medium"}</Text>
              <div className="catalog-number-probe" data-number-probe={role}>
                {["111111", "888888", "000000"].map((digits) => <Text key={digits} as="span" textStyle={role}>{digits}</Text>)}
              </div>
            </div>
          ))}
        </section>

        <section className="catalog-section bg-home-ui-surface" aria-labelledby="buttons-title">
          <Heading id="buttons-title" level={2} textStyle="section-title">Buttons</Heading>
          <div className="catalog-buttons">
            <Button {...state} ref={primaryRef} onClick={activate}>Primary</Button>
            <Button {...state} variant="secondary" onClick={activate}>Secondary</Button>
            <Button {...state} variant="quiet" onClick={activate}>Quiet</Button>
          </div>
          <Button {...state} variant="secondary" onClick={activate}>A long button label that must stay readable at narrow widths and enlarged text</Button>
          <Text as="div" textStyle="secondary"><output aria-live="polite">Activations: {activations}</output></Text>
        </section>

        <section className="catalog-section bg-home-ui-surface" aria-labelledby="icons-title">
          <Heading id="icons-title" level={2} textStyle="section-title">Icon buttons</Heading>
          <Text textStyle="secondary" tone="muted">20px / 24px Phosphor artwork. Minimum 44px targets.</Text>
          <div className="catalog-buttons">
            <IconButton {...state} icon={PlusIcon} aria-label="Add example" onClick={activate} />
            <IconButton {...state} icon={XIcon} aria-label="Close example" onClick={activate} />
            <IconButton {...state} icon={ArrowRightIcon} iconSize={24} variant="secondary" aria-label="Next example" onClick={activate} />
            <IconButton {...state} icon={CheckIcon} iconSize={24} variant="primary" aria-label="Select example" onClick={activate} />
          </div>
        </section>

        <section className="catalog-section bg-home-ui-surface" aria-labelledby="amounts-title">
          <Heading id="amounts-title" level={2} textStyle="section-title">Formatted values</Heading>
          <Text textStyle="secondary" tone="muted">Static strings, not live balances. Full values wrap without truncation.</Text>
          {amounts.map((amount) => <Text key={amount} textStyle="amount">{amount}</Text>)}
          <Text>Currency glyphs: $ € £ ¥ ₹ ₦ ₩ ₱ ₫ ₴ ₺ ₿</Text>
          <Text textStyle="secondary" tone="muted">DM Mono covers $ € £ ¥. These currencies and scripts use device glyph fallback; coverage and alignment are not guaranteed:</Text>
          <Text textStyle="row-value" data-font-coverage="currencies">₹₦₩₱₫₴₺₿</Text>
          <Text textStyle="row-value" data-font-coverage="arabic" lang="ar" dir="rtl">العربية</Text>
          <Text textStyle="row-value" data-font-coverage="japanese" lang="ja">日本語</Text>
        </section>
      </div>
    </>
  );
}
