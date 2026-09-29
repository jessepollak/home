"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  OPERATOR_FEE_MAX_BPS,
  parseOperatorFeeSettings,
  parseRevenueDestination,
  revenueDestinationChecksum,
  type OperatorFeeSettings,
} from "@/shared/fees/operator-fee";
import { DeploymentExpiredError, deploymentHeaders, throwIfDeploymentExpired } from "@/client/query/deployment-headers";
import { formatAddress, formatPresentationDate } from "@/shared/formatting";
import { formatBasisPoints } from "@/shared/formatting/money";
import {
  OPERATOR_SETTINGS_CONTRACT_VERSION,
  parseOperatorSettingsErrorResponse,
  parseSettingsResponse,
  type OperatorSettingsErrorCode,
  type SettingsEntry,
} from "@/shared/operator-settings/contract";

export type FeeSettingsState = SettingsEntry<OperatorFeeSettings>["settings"];

type Draft = { bps: string; destination: string };
type Notice = { kind: "error" | "conflict"; message: string } | null;

const saveErrors: Record<OperatorSettingsErrorCode, string> = {
  UNAUTHENTICATED: "Your session ended. Sign in again, then save.",
  OPERATOR_FORBIDDEN: "This account can’t change settings.",
  CROSS_ORIGIN: "Reload this page, then save again.",
  INVALID_REQUEST: "Home didn’t accept these values. Check them and try again.",
  NOT_FOUND: "Fee settings aren’t available on this deployment.",
  SETTINGS_CONFLICT: "Settings changed. Reload this page to see the latest values.",
  OPERATOR_CHANGED: "A different operator is signed in. Reload this page before saving.",
  SETTINGS_UNAVAILABLE: "Settings are unavailable right now. Try again in a moment.",
};

const conflictNotice = "Someone else saved fee settings. The latest values are shown; review them and save again.";

function draftFrom(value: OperatorFeeSettings): Draft {
  const recipient = value.trade.recipient;
  return { bps: String(value.trade.bps), destination: recipient ? revenueDestinationChecksum(recipient) : "" };
}

function serverKey(settings: FeeSettingsState): string {
  return `${settings.source}:${settings.revision}:${settings.updatedAt ?? ""}`;
}

function validate(draft: Draft) {
  const bpsText = draft.bps.trim();
  const bps = /^\d{1,4}$/.test(bpsText) ? Number(bpsText) : Number.NaN;
  const bpsError = Number.isSafeInteger(bps) && bps <= OPERATOR_FEE_MAX_BPS
    ? null : `Enter a whole number from 0 to ${OPERATOR_FEE_MAX_BPS}.`;
  const destinationText = draft.destination.trim();
  const recipient = destinationText === "" ? null : parseRevenueDestination(destinationText);
  const destinationError = destinationText !== "" && recipient === null
    ? "Enter a valid Base address."
    : bpsError === null && bps > 0 && recipient === null ? "Add a revenue destination to charge a fee." : null;
  const value = bpsError || destinationError ? null : parseOperatorFeeSettings({ trade: { bps, recipient } });
  return { bps: bpsError ? null : bps, bpsError, destinationError, value };
}

function savedLine(settings: FeeSettingsState): string {
  if (settings.source === "default" || !settings.updatedAt) return "Not saved yet.";
  const when = formatPresentationDate(settings.updatedAt, { style: "date-time-zone", timeZone: "UTC" });
  return settings.updatedBy ? `Last updated ${when} by ${formatAddress(settings.updatedBy)}` : `Last updated ${when}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function FeeSettingsForm({ initial, operator }: { initial: FeeSettingsState; operator: `0x${string}` }) {
  const id = useId();
  const [stored, setStored] = useState(initial);
  const [draft, setDraft] = useState(() => draftFrom(initial.value));
  const [touched, setTouched] = useState({ bps: false, destination: false });
  const [confirming, setConfirming] = useState<OperatorFeeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [status, setStatus] = useState("");
  const bpsRef = useRef<HTMLInputElement>(null);
  const destinationRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusSave = useRef(false);
  const [serverSignature, setServerSignature] = useState(() => serverKey(initial));
  const storedRevision = useRef(initial.revision);
  const hadConfirmation = useRef(false);

  const result = validate(draft);
  const bpsError = touched.bps ? result.bpsError : null;
  const destinationError = touched.destination ? result.destinationError : null;
  const locked = saving || confirming !== null;

  useEffect(() => {
    if (confirming) {
      hadConfirmation.current = true;
      confirmHeadingRef.current?.focus();
      return;
    }
    if (hadConfirmation.current || focusSave.current) {
      hadConfirmation.current = false;
      focusSave.current = false;
      saveRef.current?.focus();
    }
  }, [confirming, saving]);

  useLayoutEffect(() => {
    storedRevision.current = stored.revision;
  }, [stored.revision]);

  function edit(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setStatus("");
  }

  function applyStored(settings: FeeSettingsState) {
    setStored(settings);
    setDraft(draftFrom(settings.value));
    setTouched({ bps: false, destination: false });
  }

  const incomingSignature = serverKey(initial);
  if (incomingSignature !== serverSignature) {
    setServerSignature(incomingSignature);
    if (incomingSignature !== serverKey(stored) && initial.revision >= stored.revision) {
      setConfirming(null);
      setStatus("");
      applyStored(initial);
    }
  }

  async function save(value: OperatorFeeSettings) {
    setSaving(true);
    setNotice(null);
    setStatus("");
    const headers = { "content-type": "application/json", ...deploymentHeaders() };
    try {
      const response = await fetch("/api/admin/settings/fees", {
        method: "PUT",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ version: OPERATOR_SETTINGS_CONTRACT_VERSION, expectedRevision: stored.revision, value, operator }),
      });
      const body = await readJson(response);
      if (response.ok) {
        const saved = parseSettingsResponse(body);
        const savedValue = saved?.domain === "fees" ? parseOperatorFeeSettings(saved.settings.value) : null;
        if (!saved || !savedValue) {
          setNotice({ kind: "error", message: "The save couldn’t be confirmed. Reload this page to check the current values." });
          return;
        }
        if (saved.settings.revision < storedRevision.current) {
          setNotice({ kind: "conflict", message: conflictNotice });
          return;
        }
        applyStored({ ...saved.settings, value: savedValue });
        setStatus("Saved. New quotes use these settings.");
        return;
      }
      const failure = parseOperatorSettingsErrorResponse(body);
      throwIfDeploymentExpired(response, headers, failure?.error.code ?? null);
      const currentEntry = failure?.current?.domain === "fees" ? failure.current : null;
      const current = currentEntry ? parseOperatorFeeSettings(currentEntry.settings.value) : null;
      if (failure?.error.code === "SETTINGS_CONFLICT" && currentEntry && current) {
        if (currentEntry.settings.revision >= storedRevision.current) applyStored({ ...currentEntry.settings, value: current });
        setNotice({ kind: "conflict", message: conflictNotice });
        return;
      }
      if (response.status === 409 && failure?.error.code === "OPERATOR_CHANGED") {
        if (currentEntry && current && currentEntry.settings.revision >= storedRevision.current) applyStored({ ...currentEntry.settings, value: current });
        setNotice({ kind: "conflict", message: saveErrors.OPERATOR_CHANGED });
        return;
      }
      setNotice({
        kind: "error",
        message: failure ? saveErrors[failure.error.code]
          : response.status === 503 ? saveErrors.SETTINGS_UNAVAILABLE : "Couldn’t save. Try again.",
      });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof DeploymentExpiredError ? error.message : "Couldn’t reach Home. Check your connection and try again." });
    } finally {
      focusSave.current = true;
      setConfirming(null);
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setTouched({ bps: true, destination: true });
    setNotice(null);
    if (!result.value) {
      (result.bpsError ? bpsRef : destinationRef).current?.focus();
      return;
    }
    const next = result.value;
    if (next.trade.bps === stored.value.trade.bps && next.trade.recipient === stored.value.trade.recipient) {
      setStatus("No changes to save.");
      return;
    }
    if (next.trade.recipient !== null && next.trade.recipient !== stored.value.trade.recipient) {
      setConfirming(next);
      return;
    }
    void save(next);
  }

  function back() {
    focusSave.current = true;
    setConfirming(null);
  }

  const bpsDescription = result.bps === null
    ? `Up to ${OPERATOR_FEE_MAX_BPS} bps (${formatBasisPoints(BigInt(OPERATOR_FEE_MAX_BPS))}).`
    : `${result.bps} bps = ${formatBasisPoints(BigInt(result.bps))} of each swap.`;

  return (
    <form noValidate onSubmit={submit} aria-labelledby={`${id}-title`} className="w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle><h2 id={`${id}-title`}>Fees</h2></CardTitle>
          <CardDescription>Changes apply to new quotes only.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={bpsError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-bps`}>Swap fee</FieldLabel>
              <InputGroup className="h-11 max-w-40">
                <InputGroupInput
                  ref={bpsRef}
                  id={`${id}-bps`}
                  className="h-11"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.bps}
                  readOnly={locked}
                  aria-invalid={bpsError ? true : undefined}
                  aria-describedby={`${id}-bps-help${bpsError ? ` ${id}-bps-error` : ""}`}
                  onChange={(event) => edit("bps", event.target.value)}
                  onBlur={() => setTouched((current) => ({ ...current, bps: true }))}
                />
                <InputGroupAddon align="inline-end">bps</InputGroupAddon>
              </InputGroup>
              <FieldDescription id={`${id}-bps-help`}>{bpsDescription}</FieldDescription>
              {bpsError ? <FieldError id={`${id}-bps-error`}>{bpsError}</FieldError> : null}
            </Field>
            <Field data-invalid={destinationError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-destination`}>Revenue destination</FieldLabel>
              <Input
                ref={destinationRef}
                id={`${id}-destination`}
                className="h-11"
                variant="code"
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                value={draft.destination}
                readOnly={locked}
                aria-invalid={destinationError ? true : undefined}
                aria-describedby={`${id}-destination-help${destinationError ? ` ${id}-destination-error` : ""}`}
                onChange={(event) => edit("destination", event.target.value)}
                onBlur={() => setTouched((current) => ({ ...current, destination: true }))}
              />
              <FieldDescription id={`${id}-destination-help`}>
                A Base address that only receives fees. Use a multisig or another account held outside Home.
              </FieldDescription>
              {destinationError ? <FieldError id={`${id}-destination-error`}>{destinationError}</FieldError> : null}
            </Field>
          </FieldGroup>
        </CardContent>
        {confirming?.trade.recipient ? (
          <CardContent>
            <Card size="sm" aria-labelledby={`${id}-confirm-title`} role="group">
              <CardContent className="grid gap-3">
                <h3 id={`${id}-confirm-title`} ref={confirmHeadingRef} tabIndex={-1} className="rounded-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  Confirm revenue destination
                </h3>
                <p className="text-muted-foreground">Fees from new quotes will be sent to this address. Check every character.</p>
                <p className="font-mono text-sm break-all">{revenueDestinationChecksum(confirming.trade.recipient)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="touch" loading={saving} onClick={() => void save(confirming)}>Confirm and save</Button>
                  <Button type="button" size="touch" variant="outline" disabled={saving} onClick={back}>Back</Button>
                </div>
              </CardContent>
            </Card>
          </CardContent>
        ) : null}
        {notice ? (
          <CardContent>
            <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
              {notice.kind === "error" ? <AlertIcon><CircleAlertIcon /></AlertIcon> : null}
              <AlertTitle>{notice.kind === "conflict" ? "Settings changed" : "Not saved"}</AlertTitle>
              <AlertDescription>{notice.message}</AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
        <CardFooter className="flex-wrap justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <p role="status" className="font-medium">{status}</p>
            <p className="text-muted-foreground">{savedLine(stored)}</p>
          </div>
          {confirming ? null : <Button ref={saveRef} type="submit" size="touch" loading={saving}>Save</Button>}
        </CardFooter>
      </Card>
    </form>
  );
}
