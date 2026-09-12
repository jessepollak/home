"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Bleed, Button, Divider, EmptyState, Field, Heading, IconButton, Inline, Input, Inset, ListRow, Select, Skeleton, Stack, StatusMessage, Text, Toast, ToastViewport, type TextStyle } from "@home/ui";
import { Sheet } from "@home/ui/sheet";
import { MoneyTicker } from "@home/ui/money-ticker";
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

type SheetSpecimenState = "open" | "non-dismissible" | "footer" | "reduced-motion";

function SheetSpecimen() {
  const [state, setState] = useState<SheetSpecimenState | null>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const triggerRefs = useRef<Partial<Record<SheetSpecimenState, HTMLButtonElement>>>({});
  const dismissible = state !== "non-dismissible";
  const hasFooter = state === "footer";

  const openSheet = (next: SheetSpecimenState) => setState(next);
  const closeSheet = () => setState(null);

  return (
    <section className="catalog-section bg-home-ui-surface" aria-labelledby="sheet-title">
      <Heading id="sheet-title" level={2} textStyle="section-title">Sheet</Heading>
      <Text textStyle="secondary" tone="muted">Native dialog lifecycle, anchored layout, optional slots, and gesture ownership.</Text>
      <div className="catalog-sheet-matrix" aria-label="Sheet state matrix">
        {([
          ["open", "Open sheet"],
          ["non-dismissible", "Open non-dismissible sheet"],
          ["footer", "Open sheet with footer"],
          ["reduced-motion", "Open reduced-motion sheet"],
        ] as const).map(([next, label]) => (
          <Button
            key={next}
            ref={(button) => { triggerRefs.current[next] = button ?? undefined; }}
            variant="secondary"
            onClick={() => openSheet(next)}
          >
            {label}
          </Button>
        ))}
      </div>
      <Sheet
        open={state !== null}
        aria-labelledby="sheet-specimen-dialog-title"
        aria-describedby="sheet-specimen-description"
        onDismiss={closeSheet}
        dismissible={dismissible}
        dragDismiss
        initialFocusRef={initialFocusRef}
        header={(
          <div className="catalog-sheet-header">
            <Heading id="sheet-specimen-dialog-title" level={3} textStyle="sheet-title">
              {state === "non-dismissible" ? "Required decision" : "Sheet specimen"}
            </Heading>
            {dismissible ? (
              <IconButton icon={XIcon} variant="secondary" aria-label="Close sheet" onClick={closeSheet} />
            ) : null}
          </div>
        )}
        footer={hasFooter ? (
          <Button onClick={closeSheet}>Confirm sheet action</Button>
        ) : undefined}
        onClosed={() => {
          if (state) triggerRefs.current[state]?.focus({ preventScroll: true });
        }}
      >
        <Stack space="3">
          <Text id="sheet-specimen-description">
            {state === "non-dismissible"
              ? "Escape and backdrop dismissal are disabled until the required action is complete."
              : state === "reduced-motion"
                ? "This state follows the operating system reduced-motion preference."
                : "Sheet content stays readable at narrow widths and enlarged text."}
          </Text>
          <Button ref={initialFocusRef} variant="secondary" onClick={state === "non-dismissible" ? closeSheet : undefined}>
            {state === "non-dismissible" ? "Finish required action" : "Sheet action"}
          </Button>
        </Stack>
      </Sheet>
    </section>
  );
}

function FeedbackSpecimens() {
  const [toastVisible, setToastVisible] = useState(false);

  return (
    <section className="catalog-section bg-home-ui-surface" aria-labelledby="feedback-title">
      <Heading id="feedback-title" level={2} textStyle="section-title">Feedback</Heading>
      <Text textStyle="secondary" tone="muted">Loading, empty, status, and transient notification shells without product-state decisions.</Text>
      <div className="catalog-feedback-matrix">
        <div className="catalog-feedback-card" data-feedback="skeleton">
          <Text textStyle="metadata" tone="muted">Skeleton rows</Text>
          <Skeleton shape="text" width="75%" height="0.75rem" rows={3} />
          <Skeleton shape="circle" width="2.5rem" height="2.5rem" />
        </div>
        <div className="catalog-feedback-card" data-feedback="empty-state">
          <EmptyState
            title="No activity yet"
            description="Completed actions will appear here."
            action={<Button variant="secondary">Review balances</Button>}
          />
        </div>
        <div className="catalog-feedback-card" data-feedback="status-message">
          <StatusMessage title="Portfolio refreshed">Balances are up to date.</StatusMessage>
          <StatusMessage tone="error" role="alert" title="Activity unavailable">
            Try again when the connection recovers.
          </StatusMessage>
        </div>
      </div>
      <Button variant="secondary" onClick={() => setToastVisible(true)}>Show toast</Button>
      <ToastViewport>
        {toastVisible ? (
          <Toast tone="success" duration={5_000} onDismiss={() => setToastVisible(false)}>
            Action confirmed
          </Toast>
        ) : null}
      </ToastViewport>
    </section>
  );
}

const tokenSpecimens = [
  { name: "--home-ui-color-focus-halo", kind: "color" },
  { name: "--home-ui-color-overlay", kind: "color" },
  { name: "--home-ui-color-status-success-text", kind: "color" },
  { name: "--home-ui-color-status-success-background", kind: "color" },
  { name: "--home-ui-color-status-success-border", kind: "color" },
  { name: "--home-ui-color-status-warning-text", kind: "color" },
  { name: "--home-ui-color-status-warning-background", kind: "color" },
  { name: "--home-ui-color-status-warning-border", kind: "color" },
  { name: "--home-ui-color-status-error-text", kind: "color" },
  { name: "--home-ui-color-status-error-background", kind: "color" },
  { name: "--home-ui-color-status-error-border", kind: "color" },
  { name: "--home-ui-shadow-popover", kind: "shadow" },
  { name: "--home-ui-shadow-sheet", kind: "shadow" },
  { name: "--home-ui-layer-sheet", kind: "layer" },
  { name: "--home-ui-layer-popover", kind: "layer" },
  { name: "--home-ui-layer-toast", kind: "layer" },
  { name: "--home-ui-easing-standard", kind: "easing" },
  { name: "--home-ui-easing-enter", kind: "easing" },
  { name: "--home-ui-easing-exit", kind: "easing" },
] as const;

export function FoundationCatalog() {
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [textScale, setTextScale] = useState("100");
  const [width, setWidth] = useState("fluid");
  const [activations, setActivations] = useState(0);
  const [rowActivations, setRowActivations] = useState(0);
  const [tickerValue, setTickerValue] = useState("$1,234.56");
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
            <Button {...state} hapticFeedback="selection" onClick={activate}>Confirm</Button>
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

        <section className="catalog-section bg-home-ui-surface" aria-labelledby="fields-title">
          <Heading id="fields-title" level={2} textStyle="section-title">Fields</Heading>
          <Text textStyle="secondary" tone="muted">Native controls with shared labels, help, errors, adornments, and action layout.</Text>
          <div className="catalog-field-matrix">
            <Field label="Email address" htmlFor="catalog-email" hint="Used for receipt delivery" required>
              <Input id="catalog-email" type="email" placeholder="name@example.com" disabled={disabled} />
            </Field>
            <Field label="Deposit amount" htmlFor="catalog-amount" hint="Enter the exact fiat amount">
              <Input id="catalog-amount" inputMode="decimal" prefix="$" suffix="USD" placeholder="0.00" disabled={disabled} />
            </Field>
            <Field
              label="Wallet address"
              htmlFor="catalog-address"
              error="Enter a valid Base address"
              action={<Button variant="quiet" disabled={disabled}>Paste</Button>}
            >
              <Input id="catalog-address" defaultValue="not-an-address" disabled={disabled} />
            </Field>
            <Field label="Country" htmlFor="catalog-country" hint="Sets how money is shown">
              <Select id="catalog-country" defaultValue="US" disabled={disabled}>
                <option value="US">United States</option>
                <option value="GB">United Kingdom</option>
                <option value="ID">Indonesia</option>
              </Select>
            </Field>
          </div>
        </section>

        <section className="catalog-section bg-home-ui-surface" aria-labelledby="list-row-title">
          <Heading id="list-row-title" level={2} textStyle="section-title">List rows, badges, and dividers</Heading>
          <Text textStyle="secondary" tone="muted">Static, pressable, and linked rows share readable wrapping, separators, and a 44px minimum target.</Text>
          <ul className="catalog-list-rows" aria-label="List row state matrix">
            <ListRow
              leading={<span className="catalog-row-mark">US</span>}
              label="USD Coin"
              description="Available balance"
              value="$12,345.67"
              valueDescription="10,250.42 USDC"
            />
            <ListRow
              leading={<span className="catalog-row-mark">↓</span>}
              label="Received from a wallet with a long and detailed display name"
              description="September 12, 2026 at 10:42 AM"
              value="+$1,234,567.89"
              valueDescription="Confirmed"
              tone="success"
              onPress={() => setRowActivations((count) => count + 1)}
              aria-label="Open received transaction"
            />
            <ListRow
              leading={<span className="catalog-row-mark">ETH</span>}
              label="Ethereum"
              description="Linked row"
              value="$4,321.09"
              valueDescription="−1.2% today"
              tone="error"
              href="#list-row-title"
              aria-label="View Ethereum details"
            />
          </ul>
          <Text as="span" textStyle="secondary" data-row-activations>Row activations: {rowActivations}</Text>
          <div className="catalog-badge-matrix" aria-label="Badge tone matrix">
            <Badge>Neutral</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="success" icon={<CheckIcon />}>Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="error">Error</Badge>
          </div>
          <Divider />
          <div className="catalog-divider-matrix">
            <Text as="span" textStyle="secondary">Before</Text>
            <Divider orientation="vertical" decorative={false} aria-label="Before and after" />
            <Text as="span" textStyle="secondary">After</Text>
          </div>
        </section>

        <section className="catalog-section bg-home-ui-surface" aria-labelledby="layout-title">
          <Heading id="layout-title" level={2} textStyle="section-title">Layout</Heading>
          <Stack space="3" data-layout="stack">
            <Text>Stack item</Text>
            <Text>Stack item</Text>
          </Stack>
          <Inline space="2" data-layout="inline">
            <Text as="span">Inline item</Text>
            <Text as="span">Inline item</Text>
            <Text as="span">Inline item</Text>
          </Inline>
          <Inset space="3" className="catalog-layout-frame" data-layout="inset">
            <Stack space="2">
              <Text>Inset content</Text>
              <Bleed space="3" className="catalog-layout-bleed" data-layout="bleed">
                <Text>Bleed content</Text>
              </Bleed>
            </Stack>
          </Inset>
          <Inline space={{ custom: "18px" }} data-layout="custom">
            <Text as="span">Custom gap</Text>
            <Text as="span">18px</Text>
          </Inline>
        </section>

        <section className="catalog-section bg-home-ui-surface" aria-labelledby="surfaces-title">
          <Heading id="surfaces-title" level={2} textStyle="section-title">Surfaces</Heading>
          <Inline space="3" className="catalog-surfaces">
            {[
              ["surface-primary", "Primary"],
              ["surface-secondary", "Secondary"],
              ["surface-accent", "Accent"],
              ["surface-accent surface-tinted", "Tinted accent"],
            ].map(([className, label]) => (
              <Inset key={label} space="3" className={`${className} catalog-surface`} data-surface={label.toLowerCase().replace(" ", "-")}>
                <Stack space="2">
                  <Heading level={3} textStyle="row-label">{label}</Heading>
                  <Text>Default text</Text>
                  <Text tone="muted">Muted text</Text>
                  <span className="catalog-separator" aria-hidden="true" />
                </Stack>
              </Inset>
            ))}
          </Inline>
        </section>

        <section className="catalog-section bg-home-ui-surface" aria-labelledby="tokens-title">
          <Heading id="tokens-title" level={2} textStyle="section-title">Semantic tokens</Heading>
          <Text textStyle="secondary" tone="muted">Demonstrated focus, overlay, status, elevation, layer, and easing roles.</Text>
          <div className="catalog-token-grid">
            {tokenSpecimens.map(({ name, kind }) => (
              <div className="catalog-token" data-token={name} data-token-kind={kind} key={name}>
                <span
                  aria-hidden="true"
                  className="catalog-token-swatch"
                  style={kind === "color"
                    ? { background: `var(${name})` }
                    : kind === "shadow"
                      ? { boxShadow: `var(${name})` }
                      : kind === "layer"
                        ? { zIndex: `var(${name})` }
                        : { transitionTimingFunction: `var(${name})` }}
                />
                <Text as="span" className="catalog-token-name" textStyle="metadata">{name}</Text>
              </div>
            ))}
          </div>
        </section>

        <SheetSpecimen />
        <FeedbackSpecimens />

        <section className="catalog-section bg-home-ui-surface" aria-labelledby="ticker-title">
          <Heading id="ticker-title" level={2} textStyle="section-title">Balance ticker</Heading>
          <Text textStyle="secondary" tone="muted">Already-formatted money with anchored symbols and separators.</Text>
          <MoneyTicker
            className="home-ui-text"
            data-text-style="row-value"
            data-ticker-specimen
            value={tickerValue}
          />
          <Button
            variant="secondary"
            onClick={() => setTickerValue((current) => current === "$1,234.56" ? "$9,876.54" : "$1,234.56")}
          >
            Update balance ticker
          </Button>
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
