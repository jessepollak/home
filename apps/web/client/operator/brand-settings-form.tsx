"use client";

import { useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeploymentExpiredError, deploymentHeaders, throwIfDeploymentExpired } from "@/client/query/deployment-headers";
import { formatAddress, formatPresentationDate } from "@/shared/formatting";
import { readJson } from "@/shared/http/read-json";
import {
  BRAND_DEFAULTS,
  BRAND_SETTINGS_DOMAIN,
  brandSettingsPutRequest,
  parseBrandSettings,
  parseBrandSettingsResponse,
  type BrandSettings,
  type BrandSettingsResponse,
} from "@/shared/operator-branding/contract";
import { brandCopyName, deriveBrandTheme } from "@/shared/operator-branding/theme";
import { parseOperatorSettingsErrorResponse, type OperatorSettingsErrorCode } from "@/shared/operator-settings/contract";

export type BrandSettingsState = BrandSettingsResponse["settings"];

type Draft = { [Key in keyof BrandSettings]: string };
type Blocked = { kind: "conflict"; latest: BrandSettingsState } | { kind: "operator" } | null;

const NAME_MAX = 40;
const DESCRIPTION_MAX = 160;

const saveErrors: Record<OperatorSettingsErrorCode, string> = {
  UNAUTHENTICATED: "Your session ended. Sign in again, then save.",
  AUTH_UNAVAILABLE: "Authentication is temporarily unavailable. Your changes are kept; try again in a moment.",
  OPERATOR_FORBIDDEN: "This account can’t change settings.",
  CROSS_ORIGIN: "Reload this page, then save again.",
  INVALID_REQUEST: "Home didn’t accept these values. Check them and try again.",
  NOT_FOUND: "Brand settings aren’t available on this deployment.",
  SETTINGS_CONFLICT: "Someone else saved brand settings.",
  OPERATOR_CHANGED: "A different operator is signed in. Reload this page before saving.",
  SETTINGS_UNAVAILABLE: "Settings are unavailable right now. Your changes are kept; try again in a moment.",
};

function draftFrom(value: BrandSettings): Draft {
  return { ...value };
}

function normalizeColor(text: string): string {
  const trimmed = text.trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(trimmed) ? `#${trimmed}` : trimmed;
}

function candidate(draft: Draft) {
  return {
    displayName: draft.displayName.trim(),
    description: draft.description.trim(),
    primaryColor: normalizeColor(draft.primaryColor),
    backgroundColor: normalizeColor(draft.backgroundColor),
  };
}

function validate(draft: Draft) {
  const next = candidate(draft);
  const nameLength = [...next.displayName].length;
  const descriptionLength = [...next.description].length;
  const displayName = nameLength === 0 ? "Enter a display name."
    : nameLength > NAME_MAX ? `Use ${NAME_MAX} characters or fewer.`
      : parseBrandSettings({ ...BRAND_DEFAULTS, displayName: next.displayName }) === null ? "Remove control or text-direction characters." : null;
  const description = descriptionLength === 0 ? "Enter a description."
    : descriptionLength > DESCRIPTION_MAX ? `Use ${DESCRIPTION_MAX} characters or fewer.`
      : parseBrandSettings({ ...BRAND_DEFAULTS, description: next.description }) === null ? "Remove control or text-direction characters." : null;
  const primaryColor = parseBrandSettings({ ...BRAND_DEFAULTS, primaryColor: next.primaryColor }) === null ? "Enter a color like #0052ff." : null;
  const backgroundColor = parseBrandSettings({ ...BRAND_DEFAULTS, backgroundColor: next.backgroundColor }) === null ? "Enter a color like #ffffff." : null;
  const value = displayName || description || primaryColor || backgroundColor ? null : parseBrandSettings(next);
  return { errors: { displayName, description, primaryColor, backgroundColor }, value };
}

function canonicalField(field: keyof BrandSettings, value: string): string {
  return field === "primaryColor" || field === "backgroundColor" ? normalizeColor(value) : value.trim();
}

const SAVE_TIMEOUT_MS = 15_000;

function sameBrand(a: BrandSettings, b: BrandSettings): boolean {
  return a.displayName === b.displayName && a.description === b.description && a.primaryColor === b.primaryColor && a.backgroundColor === b.backgroundColor;
}

function sourceLine(settings: BrandSettingsState): string {
  if (settings.source === "default" || !settings.updatedAt) return "Using deployment defaults. Nothing is saved yet.";
  const when = formatPresentationDate(settings.updatedAt, { style: "date-time-zone", timeZone: "UTC" });
  return settings.updatedBy ? `Saved settings, revision ${settings.revision}. Updated ${when} by ${formatAddress(settings.updatedBy)}.` : `Saved settings, revision ${settings.revision}. Updated ${when}.`;
}

function ColorField({ id, label, text, error, help, locked, onChange }: {
  id: string; label: string; text: string; error: string | null; help: string; locked: boolean; onChange: (value: string) => void;
}) {
  const color = normalizeColor(text);
  const valid = error === null;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`${id}-text`}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label={`${label} picker`}
          className="size-11 shrink-0 cursor-pointer p-1"
          value={valid ? color : "#000000"}
          disabled={locked}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          id={`${id}-text`}
          className="h-11 max-w-40"
          variant="code"
          autoComplete="off"
          spellCheck={false}
          maxLength={7}
          value={text}
          readOnly={locked}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <FieldDescription id={`${id}-help`}>{help}</FieldDescription>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-4 shrink-0 rounded-sm border border-border" style={{ backgroundColor: color }} aria-hidden="true" />
      <span className="font-mono text-sm">{label}</span>
    </span>
  );
}

function BrandPreview({ settings }: { settings: BrandSettings }) {
  const theme = deriveBrandTheme(settings);
  const style: CSSProperties & Record<`--${string}`, string> = {
    "--background": theme.appliedBackground,
    "--foreground": theme.page?.foreground ?? "#0a0a0a",
    "--primary": theme.appliedPrimary,
    "--primary-foreground": theme.primary?.foreground ?? "#ffffff",
    "--muted-foreground": "#737373",
    "--card": "#ffffff",
    "--card-foreground": "#0a0a0a",
    "--border": "#e5e5e5",
  };
  return (
    <div role="group" aria-label="Customer preview" data-brand-preview="" style={style} className="grid gap-4 rounded-xl border border-border bg-background p-4 text-foreground">
      <p className="wrap-anywhere text-sm font-semibold">{brandCopyName(settings.displayName)}</p>
      <div className="grid gap-1 rounded-lg border border-border bg-card p-4 text-card-foreground">
        <p className="wrap-anywhere font-medium">Sign in to {brandCopyName(settings.displayName)}</p>
        <p className="wrap-anywhere text-sm text-muted-foreground">{settings.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Continue</span>
        <span className="text-sm font-medium text-primary underline underline-offset-4">Learn more</span>
      </div>
    </div>
  );
}

export function BrandSettingsForm({ initial, operator }: { initial: BrandSettingsState; operator: `0x${string}` }) {
  const id = useId();
  const router = useRouter();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(() => draftFrom(initial.value));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<Blocked>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const result = validate(draft);
  const preview = result.value ?? candidate(draft);
  const previewable = result.value ?? parseBrandSettings({
    displayName: result.errors.displayName ? baseline.value.displayName : preview.displayName,
    description: result.errors.description ? baseline.value.description : preview.description,
    primaryColor: result.errors.primaryColor ? baseline.value.primaryColor : preview.primaryColor,
    backgroundColor: result.errors.backgroundColor ? baseline.value.backgroundColor : preview.backgroundColor,
  }) ?? baseline.value;
  const theme = deriveBrandTheme(previewable);
  const dirty = !result.value || !sameBrand(result.value, baseline.value);
  const locked = saving;
  const shown = touched ? result.errors : { displayName: null, description: null, primaryColor: null, backgroundColor: null };

  const incomingKey = `${initial.revision}:${initial.updatedAt ?? ""}`;
  const [seenKey, setSeenKey] = useState(incomingKey);
  if (incomingKey !== seenKey && !saving) {
    setSeenKey(incomingKey);
    if (initial.revision > baseline.revision) {
      if (dirty) setBlocked((current) => current?.kind === "operator" || (current?.kind === "conflict" && current.latest.revision >= initial.revision) ? current : { kind: "conflict", latest: initial });
      else adopt(initial, false);
    }
  }

  function edit(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setStatus("");
  }

  function adopt(state: BrandSettingsState, keepDraft: boolean) {
    setBaseline(state);
    if (keepDraft) {
      setDraft((current) => {
        const merged = { ...current };
        for (const field of ["displayName", "description", "primaryColor", "backgroundColor"] as const) {
          if (canonicalField(field, current[field]) === baseline.value[field]) merged[field] = state.value[field];
        }
        return merged;
      });
    } else { setDraft(draftFrom(state.value)); setTouched(false); }
    setBlocked(null);
    setError("");
    setStatus("");
  }

  async function save(value: BrandSettings) {
    setSaving(true);
    setError("");
    setStatus("");
    const headers = { "content-type": "application/json", ...deploymentHeaders() };
    try {
      const response = await fetch(`/api/admin/settings/${BRAND_SETTINGS_DOMAIN}`, {
        method: "PUT",
        credentials: "same-origin",
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        headers,
        body: JSON.stringify(brandSettingsPutRequest(baseline.revision, value, operator)),
      });
      const body: unknown = await readJson(response).catch(() => null);
      if (response.ok) {
        const saved = parseBrandSettingsResponse(body);
        if (!saved) {
          setError("The save couldn’t be confirmed. Reload this page to check the current values.");
          return;
        }
        setBaseline(saved.settings);
        setDraft(draftFrom(saved.settings.value));
        setStatus("Saved. Customers see this the next time they open a page.");
        router.refresh();
        return;
      }
      const failure = parseOperatorSettingsErrorResponse(body);
      throwIfDeploymentExpired(response, headers, failure?.error.code ?? null);
      if (failure?.error.code === "SETTINGS_CONFLICT") {
        const latest = parseBrandSettingsResponse(failure.current);
        if (latest) { setBlocked({ kind: "conflict", latest: latest.settings }); return; }
        setError("Someone else saved brand settings. Reload this page to review them.");
        return;
      }
      if (failure?.error.code === "OPERATOR_CHANGED") { setBlocked({ kind: "operator" }); return; }
      setError(failure ? saveErrors[failure.error.code] : response.status === 503 ? saveErrors.SETTINGS_UNAVAILABLE : "Couldn’t save. Your changes are kept; try again.");
    } catch (cause) {
      setError(cause instanceof DeploymentExpiredError ? cause.message
        : cause instanceof DOMException && cause.name === "TimeoutError" ? "Saving took too long, so it may or may not have gone through. Your changes are kept; try again to find out."
          : "Couldn’t reach Home. Your changes are kept; check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || blocked) return;
    setTouched(true);
    setStatus("");
    if (!result.value) {
      const first = (["displayName", "description", "primaryColor", "backgroundColor"] as const).find((field) => result.errors[field]);
      if (first === "displayName") nameRef.current?.focus();
      else if (first) document.getElementById(`${id}-${first}${first.endsWith("Color") ? "-text" : ""}`)?.focus();
      return;
    }
    if (sameBrand(result.value, baseline.value)) {
      setStatus("No changes to save.");
      return;
    }
    void save(result.value);
  }

  function cancel() {
    if (locked) return;
    setDraft(draftFrom(baseline.value));
    setTouched(false);
    setError("");
    setStatus("");
  }

  return (
    <form noValidate onSubmit={submit} aria-labelledby={`${id}-title`} className="w-full max-w-2xl" data-brand-settings="">
      <Card>
        <CardHeader>
          <CardTitle><h2 id={`${id}-title`}>Brand</h2></CardTitle>
          <CardDescription>Customers see the name, description and colors below on their next page load. Artwork, fonts and dark mode stay the same.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-2" aria-label="Current brand">
            <p className="text-sm font-medium">Current</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Swatch color={baseline.value.primaryColor} label={`Primary ${baseline.value.primaryColor}`} />
              <Swatch color={baseline.value.backgroundColor} label={`Background ${baseline.value.backgroundColor}`} />
            </div>
            <p className="text-sm text-muted-foreground">{sourceLine(baseline)}</p>
          </div>
          <FieldGroup>
            <Field data-invalid={shown.displayName ? true : undefined}>
              <FieldLabel htmlFor={`${id}-displayName`}>Display name</FieldLabel>
              <Input
                ref={nameRef}
                id={`${id}-displayName`}
                className="h-11"
                autoComplete="off"
                value={draft.displayName}
                readOnly={locked}
                aria-invalid={shown.displayName ? true : undefined}
                aria-describedby={`${id}-displayName-help${shown.displayName ? ` ${id}-displayName-error` : ""}`}
                onChange={(event) => edit("displayName", event.target.value)}
                onBlur={() => setTouched(true)}
              />
              <FieldDescription id={`${id}-displayName-help`}>{[...draft.displayName.trim()].length} of {NAME_MAX} characters. Shown on sign-in and access pages.</FieldDescription>
              {shown.displayName ? <FieldError id={`${id}-displayName-error`}>{shown.displayName}</FieldError> : null}
            </Field>
            <Field data-invalid={shown.description ? true : undefined}>
              <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
              <Textarea
                id={`${id}-description`}
                rows={3}
                value={draft.description}
                readOnly={locked}
                aria-invalid={shown.description ? true : undefined}
                aria-describedby={`${id}-description-help${shown.description ? ` ${id}-description-error` : ""}`}
                onChange={(event) => edit("description", event.target.value)}
                onBlur={() => setTouched(true)}
              />
              <FieldDescription id={`${id}-description-help`}>{[...draft.description.trim()].length} of {DESCRIPTION_MAX} characters. Used for the page description in search and link previews.</FieldDescription>
              {shown.description ? <FieldError id={`${id}-description-error`}>{shown.description}</FieldError> : null}
            </Field>
            <ColorField
              id={`${id}-primaryColor`}
              label="Primary color"
              text={draft.primaryColor}
              error={shown.primaryColor}
              locked={locked}
              help={theme.primaryClamped
                ? `Darkened to ${theme.appliedPrimary} on light pages so links and buttons stay readable.`
                : "Buttons, links and focus rings."}
              onChange={(value) => edit("primaryColor", value)}
            />
            <ColorField
              id={`${id}-backgroundColor`}
              label="Background color"
              text={draft.backgroundColor}
              error={shown.backgroundColor}
              locked={locked}
              help={theme.pageClamped
                ? `Light pages only. This color is lightened to ${theme.appliedBackground} so text stays readable.`
                : "A light page tint. Cards and dark mode stay the same."}
              onChange={(value) => edit("backgroundColor", value)}
            />
          </FieldGroup>
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">Preview</h3>
            <BrandPreview settings={previewable} />
            <p className="text-sm text-muted-foreground">Light theme. Not saved until you choose Save.</p>
          </div>
        </CardContent>
        {blocked?.kind === "conflict" ? (
          <CardContent>
            <Alert role="alert">
              <AlertTitle>Settings changed</AlertTitle>
              <AlertDescription>
                <p>Someone else saved brand settings (revision {blocked.latest.revision}{blocked.latest.updatedBy ? ` by ${formatAddress(blocked.latest.updatedBy)}` : ""}). Your edits are kept below and are not saved. Keep my edits applies only the fields you changed on top of the latest values.</p>
                <ul className="wrap-anywhere list-disc space-y-2 ps-5">
                  <li><strong>Display name</strong> — {blocked.latest.value.displayName}</li>
                  <li><strong>Description</strong> — {blocked.latest.value.description}</li>
                  <li><strong>Primary color</strong> — {blocked.latest.value.primaryColor}</li>
                  <li><strong>Background color</strong> — {blocked.latest.value.backgroundColor}</li>
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="touch" variant="outline" onClick={() => adopt(blocked.latest, false)}>Use latest values</Button>
                  <Button type="button" size="touch" variant="outline" onClick={() => adopt(blocked.latest, true)}>Keep my edits</Button>
                </div>
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
        {blocked?.kind === "operator" ? (
          <CardContent>
            <Alert role="alert" variant="destructive">
              <AlertIcon><CircleAlertIcon /></AlertIcon>
              <AlertTitle>Different operator</AlertTitle>
              <AlertDescription>
                <p>{saveErrors.OPERATOR_CHANGED}</p>
                <div className="mt-2"><Button type="button" size="touch" variant="outline" onClick={() => window.location.reload()}>Reload page</Button></div>
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
        {error ? (
          <CardContent>
            <Alert variant="destructive" role="alert">
              <AlertIcon><CircleAlertIcon /></AlertIcon>
              <AlertTitle>Not saved</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
        <CardFooter className="flex-wrap justify-between gap-3">
          <p role="status" className="min-w-0 font-medium">{saving ? "Saving…" : status}</p>
          <div className="flex gap-2">
            <Button type="button" size="touch" variant="outline" disabled={locked || !dirty} onClick={cancel}>Cancel</Button>
            <Button type="submit" size="touch" loading={saving} disabled={blocked !== null}>Save</Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
