"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupOption } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { parseSupportAssistantSettings, type SupportAssistantSettings as Settings } from "@/shared/operator-settings/contract";
import type { SupportCredentialResponse } from "@/shared/support/contract";
import { supportAssistantSettingsTransport, SupportAssistantSettingsConflictError, type SupportAssistantSettingsSnapshot, type SupportAssistantSettingsTransport } from "./assistant-settings-api";

const modes: { value: Settings["mode"]; label: string; description: string }[] = [
  { value: "operator", label: "Operator only", description: "People answer every conversation." },
  { value: "assistant", label: "Assistant only", description: "The assistant answers every conversation. You can still take over." },
  { value: "hybrid", label: "Assistant with handoff", description: "The assistant answers first and hands off when a person is needed." },
];

function isMode(value: unknown): value is Settings["mode"] {
  return value === "operator" || value === "assistant" || value === "hybrid";
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function SupportAssistantSettings({ operator, transport = supportAssistantSettingsTransport }: { operator: `0x${string}`; transport?: SupportAssistantSettingsTransport }) {
  const titleId = useId();
  const modeTitleId = useId();
  const [saved, setSaved] = useState<SupportAssistantSettingsSnapshot | null>(null);
  const [credential, setCredential] = useState<SupportCredentialResponse | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState("");
  const keyInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [settings, key] = await Promise.all([transport.settings(), transport.credential()]);
      setSaved(settings);
      setDraft(settings.value);
      setCredential(key);
    } catch (error) {
      setLoadError(message(error, "Support assistant settings are unavailable. Try again."));
    }
  }, [transport]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  useEffect(() => {
    if (replacingKey) keyInputRef.current?.focus();
  }, [replacingKey]);

  if (!saved || !draft || !credential) {
    return <Card aria-labelledby={titleId} role="region">
      <CardHeader><CardTitle><h2 id={titleId}>Support assistant</h2></CardTitle></CardHeader>
      <CardContent>
        {loadError ? <div role="alert" className="grid justify-items-start gap-2"><p>{loadError}</p><Button variant="outline" size="touch" onClick={() => void load()}>Try again</Button></div> : <Skeleton className="h-48 w-full" />}
      </CardContent>
    </Card>;
  }

  const model = draft.model.trim();
  const modelMissing = draft.mode !== "operator" && model === "";
  const modelInvalid = model !== "" && parseSupportAssistantSettings({ mode: "operator", model, instructions: "" }) === null;
  const instructionsInvalid = parseSupportAssistantSettings({ mode: "operator", model: "", instructions: draft.instructions }) === null;
  const modelError = modelMissing ? "Enter a model id to turn on the assistant." : modelInvalid ? "Use a model id like provider/model-name." : "";
  const instructionsError = instructionsInvalid ? "Instructions can't include control characters." : "";
  const dirty = draft.mode !== saved.value.mode || model !== saved.value.model || draft.instructions !== saved.value.instructions;
  const effective = saved.value.mode !== "operator" && saved.value.model !== "" && credential.available;
  const showKeyInput = !credential.configured || replacingKey;

  const update = (next: Partial<Settings>) => {
    setDraft((current) => current ? { ...current, ...next } : current);
    setSavedNotice(false);
    setSaveError("");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!dirty || modelError || instructionsError || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const result = await transport.saveSettings({ mode: draft.mode, model, instructions: draft.instructions }, saved.revision, operator);
      setSaved(result);
      setDraft(result.value);
      setAttempted(false);
      setSavedNotice(true);
    } catch (error) {
      if (error instanceof SupportAssistantSettingsConflictError && error.current) {
        setSaved(error.current);
        setDraft(error.current.value);
        setAttempted(false);
      }
      setSaveError(message(error, "Couldn't save settings. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    const value = apiKey.trim();
    if (keyBusy) return;
    if (value.length < 8 || value.length > 512) {
      setKeyError("Enter a key between 8 and 512 characters.");
      return;
    }
    setKeyBusy(true);
    setKeyError("");
    try {
      setCredential(await transport.saveCredential(value));
      setApiKey("");
      setReplacingKey(false);
    } catch (error) {
      setKeyError(message(error, "Couldn't save the key. Try again."));
    } finally {
      setKeyBusy(false);
    }
  };

  const removeKey = async () => {
    if (keyBusy) return;
    setKeyBusy(true);
    setKeyError("");
    try {
      setCredential(await transport.removeCredential());
      setConfirmingRemove(false);
      setReplacingKey(false);
      setApiKey("");
    } catch (error) {
      setKeyError(message(error, "Couldn't remove the key. Try again."));
    } finally {
      setKeyBusy(false);
    }
  };

  return <Card aria-labelledby={titleId} role="region">
    <CardHeader><CardTitle><h2 id={titleId}>Support assistant</h2></CardTitle></CardHeader>
    <CardContent className="grid gap-6">
      {saved.value.mode !== "operator" && !effective ? <Alert>
        <AlertTitle>Assistant unavailable</AlertTitle>
        <AlertDescription>{credential.configured ? "The saved key can't be used. Replace it to turn the assistant on. Until then, conversations go to the inbox." : "Add an AI Gateway API key to turn the assistant on. Until then, conversations go to the inbox."}</AlertDescription>
      </Alert> : null}
      <form onSubmit={(event) => void save(event)} noValidate>
        <FieldGroup>
          <div className="grid gap-3">
            <FieldTitle id={modeTitleId}>Who replies</FieldTitle>
            <RadioGroup aria-labelledby={modeTitleId} value={draft.mode} onValueChange={(value) => { if (isMode(value)) update({ mode: value }); }}>
              {modes.map((mode) => <RadioGroupOption key={mode.value} value={mode.value} label={mode.label} description={mode.description} disabled={saving} />)}
            </RadioGroup>
          </div>
          <Field data-invalid={attempted && modelError ? true : undefined}>
            <FieldLabel htmlFor="support-assistant-model">Model</FieldLabel>
            <Input id="support-assistant-model" variant="code" className="h-11" value={draft.model} onInput={(event) => update({ model: event.currentTarget.value })} disabled={saving} maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="provider/model-name" aria-invalid={attempted && modelError ? true : undefined} aria-describedby="support-assistant-model-description" />
            <FieldDescription id="support-assistant-model-description">AI Gateway model id.</FieldDescription>
            {attempted && modelError ? <FieldError>{modelError}</FieldError> : null}
          </Field>
          <Field data-invalid={attempted && instructionsError ? true : undefined}>
            <FieldLabel htmlFor="support-assistant-instructions">Instructions</FieldLabel>
            <Textarea id="support-assistant-instructions" value={draft.instructions} onInput={(event) => update({ instructions: event.currentTarget.value })} disabled={saving} maxLength={2000} aria-invalid={attempted && instructionsError ? true : undefined} aria-describedby="support-assistant-instructions-description" />
            <FieldDescription id="support-assistant-instructions-description">Added to the assistant’s guidance on every reply.</FieldDescription>
            {attempted && instructionsError ? <FieldError>{instructionsError}</FieldError> : null}
          </Field>
          <div className="grid justify-items-start gap-2">
            <Button type="submit" size="touch" loading={saving} disabled={!dirty}>Save settings</Button>
            {saveError ? <p role="alert">{saveError}</p> : savedNotice ? <p role="status">Settings saved.</p> : null}
          </div>
        </FieldGroup>
      </form>
      <Separator />
      <form onSubmit={(event) => void saveKey(event)} noValidate>
        <FieldGroup>
          {credential.configured ? <div className="grid gap-3">
            <div className="grid gap-1">
              <FieldTitle>AI Gateway API key</FieldTitle>
              <FieldDescription>Configured{credential.last4 ? ` · ends in ${credential.last4}` : ""}</FieldDescription>
            </div>
            {confirmingRemove ? <div className="grid gap-2">
              <p>Remove the key? The assistant stops replying until you add a new one.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" size="touch" loading={keyBusy} onClick={() => void removeKey()}>Remove</Button>
                <Button variant="ghost" size="touch" disabled={keyBusy} onClick={() => { setConfirmingRemove(false); setKeyError(""); }}>Cancel</Button>
              </div>
            </div> : !replacingKey ? <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="touch" onClick={() => { setReplacingKey(true); setKeyError(""); }}>Replace key</Button>
              <Button variant="ghost" size="touch" onClick={() => { setConfirmingRemove(true); setKeyError(""); }}>Remove key</Button>
            </div> : null}
          </div> : null}
          {showKeyInput && !confirmingRemove ? <Field data-invalid={keyError ? true : undefined}>
            <FieldLabel htmlFor="support-assistant-key">{credential.configured ? "New API key" : "AI Gateway API key"}</FieldLabel>
            <Input ref={keyInputRef} id="support-assistant-key" type="password" className="h-11" value={apiKey} onInput={(event) => { setApiKey(event.currentTarget.value); setKeyError(""); }} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={keyError ? true : undefined} aria-describedby="support-assistant-key-description" />
            <FieldDescription id="support-assistant-key-description">Stored encrypted. It can’t be viewed after saving.</FieldDescription>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="touch" loading={keyBusy} disabled={apiKey.trim() === ""}>Save key</Button>
              {replacingKey ? <Button variant="ghost" size="touch" disabled={keyBusy} onClick={() => { setReplacingKey(false); setApiKey(""); setKeyError(""); }}>Cancel</Button> : null}
            </div>
          </Field> : null}
          {keyError ? <FieldError>{keyError}</FieldError> : null}
        </FieldGroup>
      </form>
    </CardContent>
  </Card>;
}
