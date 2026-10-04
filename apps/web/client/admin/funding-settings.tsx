"use client";

import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Info, RotateCw } from "lucide-react";
import { AddressText } from "@/components/address-text";
import { Alert, AlertAction, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { fundingCorridorKey, type FundingCorridorView, type FundingOfferingSource, type FundingOfferingView, type FundingProviderCredentialView } from "@/shared/funding/offering";
import { formatPresentationDate } from "@/shared/formatting";
import { DeploymentExpiredError, deploymentHeaders, throwIfDeploymentExpired } from "@/client/query/deployment-headers";
import { readJson } from "@/shared/http/read-json";
import {
  OPERATOR_SETTINGS_CONTRACT_VERSION,
  parseFundingSettings,
  parseOperatorSettingsErrorResponse,
  parseSettingsResponse,
  type OperatorSettingsErrorCode,
} from "@/shared/operator-settings/contract";

type Draft = Record<string, boolean>;
type Notice = "saved" | "conflict" | "uncertain";
type SaveOutcome = "in-flight" | "saved" | "conflict" | "unavailable" | "invalid" | "uncertain";
type SaveAttempt = { id: number; revision: number; submittedRevision: number; keys: Set<string>; outcome: SaveOutcome };
type SavedSettings = { revision: number; source: FundingOfferingSource; updatedAt: string | null; updatedBy: string | null; selected: Draft };
type SaveResult =
  | { outcome: "saved" } & SavedSettings
  | { outcome: "conflict" }
  | { outcome: "uncertain" }
  | { outcome: "unavailable" | "invalid"; message: string };

const directionLabels = { onramp: "Add money", offramp: "Cash out" } as const;

const errorMessages: Record<Exclude<OperatorSettingsErrorCode, "SETTINGS_CONFLICT">, string> = {
  UNAUTHENTICATED: "Your session ended. Sign in again, then save.",
  OPERATOR_FORBIDDEN: "This account can't change settings. Sign in with an operator account.",
  OPERATOR_CHANGED: "A different operator is signed in. Reload this page before saving.",
  CROSS_ORIGIN: "The save was blocked because it didn't come from this page. Reload, then save again.",
  INVALID_REQUEST: "These settings couldn't be saved. Reload, then review and save again.",
  NOT_FOUND: "These settings couldn't be found. Reload, then try again.",
  SETTINGS_UNAVAILABLE: "Settings can't be saved right now. Nothing changed. Try again shortly.",
};

function initialDraft(view: FundingOfferingView): Draft {
  return Object.fromEntries(view.corridors.map((corridor) => [corridor.key, corridor.selected]));
}

function corridorOn(corridor: FundingCorridorView, draft: Draft): boolean {
  return Boolean(draft[corridor.key]) && (corridor.connection === "connected" || corridor.selected);
}

function joinWithOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

function corridorName(corridor: FundingCorridorView): string {
  return `${directionLabels[corridor.direction]} with ${corridor.providerName} in ${corridor.regionName}`;
}

function customerOutcome(corridor: FundingCorridorView): string {
  const action = corridor.direction === "onramp" ? "add money" : "cash out";
  const methods = corridor.paymentMethods.length > 0 ? ` via ${joinWithOr(corridor.paymentMethods)}` : "";
  const customers = corridor.connection === "connected" ? "Customers" : "When credentials are set, customers";
  return `${customers} in ${corridor.regionName} can ${action} with ${corridor.providerName}${methods}.`;
}

function groupByRegion(corridors: FundingCorridorView[]): Array<{ region: string; regionName: string; corridors: FundingCorridorView[] }> {
  const groups = new Map<string, { region: string; regionName: string; corridors: FundingCorridorView[] }>();
  for (const corridor of corridors) {
    const group = groups.get(corridor.region) ?? { region: corridor.region, regionName: corridor.regionName, corridors: [] };
    group.corridors.push(corridor);
    groups.set(corridor.region, group);
  }
  return [...groups.values()];
}

async function saveFunding(view: FundingOfferingView, draft: Draft, operator: `0x${string}`): Promise<SaveResult> {
  const headers = { "content-type": "application/json", ...deploymentHeaders() };
  try {
    const response = await fetch("/api/admin/settings/funding", {
      method: "PUT",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({
        version: OPERATOR_SETTINGS_CONTRACT_VERSION,
        expectedRevision: view.revision,
        operator,
        value: {
          corridors: view.corridors.map((corridor) => ({
            providerId: corridor.providerId, region: corridor.region, direction: corridor.direction,
            offered: corridorOn(corridor, draft),
          })),
        },
      }),
    });
    const body: unknown = await readJson(response).catch(() => null);
    if (response.ok) {
      const parsed = parseSettingsResponse(body);
      const value = parsed?.domain === "funding" ? parseFundingSettings(parsed.settings.value) : null;
      if (!parsed || !value) return { outcome: "uncertain" };
      return {
        outcome: "saved",
        revision: parsed.settings.revision,
        source: parsed.settings.source === "stored" ? "saved" : "deployment",
        updatedAt: parsed.settings.updatedAt,
        updatedBy: parsed.settings.updatedBy,
        selected: Object.fromEntries(value.corridors.map((corridor) => [fundingCorridorKey(corridor.providerId, corridor.region, corridor.direction), corridor.offered])),
      };
    }
    const code = parseOperatorSettingsErrorResponse(body)?.error.code;
    throwIfDeploymentExpired(response, headers, code ?? null);
    if (code === "SETTINGS_CONFLICT") return { outcome: "conflict" };
    if (!code) return { outcome: "uncertain" };
    return { outcome: code === "INVALID_REQUEST" || code === "CROSS_ORIGIN" ? "invalid" : "unavailable", message: errorMessages[code] };
  } catch (error) {
    return error instanceof DeploymentExpiredError ? { outcome: "invalid", message: error.message } : { outcome: "uncertain" };
  }
}

function SourceBanner({ view }: { view: FundingOfferingView }) {
  if (view.source === "deployment") {
    return (
      <Alert role="note">
        <AlertIcon><Info /></AlertIcon>
        <AlertTitle>Using deployment values — review and save</AlertTitle>
        <AlertDescription>Saving here takes over from the environment settings.</AlertDescription>
      </Alert>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      {view.updatedAt ? `Last saved ${formatPresentationDate(view.updatedAt, { style: "date-time-zone" })}` : "Saved"}
      {view.updatedBy && <><span>by</span><AddressText address={view.updatedBy} /></>}
    </p>
  );
}

function LegacyNotices({ view }: { view: FundingOfferingView }) {
  const visible = view.legacy.filter((entry) => entry.state !== "unset");
  if (visible.length === 0) return null;
  return visible.map((entry) => (
    <Alert key={entry.name} role="note">
      <AlertIcon><Info /></AlertIcon>
      <AlertTitle><code>{entry.name}</code> {entry.state === "in-effect" ? "is in effect" : "is set but ignored"}</AlertTitle>
      <AlertDescription>
        {entry.state === "in-effect"
          ? "This older variable still applies until you save here."
          : "Saved settings apply instead. You can remove this variable."}
      </AlertDescription>
    </Alert>
  ));
}

function corridorState(corridor: FundingCorridorView, on: boolean): string {
  if (corridor.connection === "not-connected") return on ? "Not connected · On when credentials are set" : "Not connected";
  return on ? "On" : "Connected, off";
}

function CorridorRow({ corridor, on, saved, onChange }: { corridor: FundingCorridorView; on: boolean; saved: boolean; onChange: (next: boolean) => void }) {
  const descriptionId = useId();
  const connected = corridor.connection === "connected";
  const pending = on !== saved;
  return (
    <Item className="flex-nowrap items-start">
      <ItemContent className="min-w-0">
        <ItemTitle truncate="wrap">
          {corridor.providerName} · {directionLabels[corridor.direction]}
          {corridor.newSinceSave && <Badge variant="outline">New</Badge>}
        </ItemTitle>
        <ItemDescription id={descriptionId} lines="wrap">
          <span className="block">{[corridor.currency, ...corridor.paymentMethods].join(" · ")}</span>
          <span className="block">
            {corridorState(corridor, on)}
            {!connected && corridor.missingEnv.length > 0 && <> · Missing {corridor.missingEnv.map((name, index) => <span key={name}>{index > 0 && ", "}<code>{name}</code></span>)}</>}
            {pending && (on ? " · Turns on when saved" : " · Pauses when saved")}
          </span>
        </ItemDescription>
      </ItemContent>
      <ItemActions className="self-center">
        <Switch
          checked={on}
          disabled={!connected && !on}
          onCheckedChange={onChange}
          aria-label={corridorName(corridor)}
          aria-describedby={descriptionId}
        />
      </ItemActions>
    </Item>
  );
}

function ProviderRow({ provider }: { provider: FundingProviderCredentialView }) {
  const missing = provider.credentials.filter((credential) => credential.state === "unset").length;
  return (
    <Item className="flex-nowrap items-start">
      <ItemContent className="min-w-0">
        <ItemTitle>{provider.displayName}</ItemTitle>
        <ItemDescription lines="wrap">
          {provider.credentials.length === 0 && "No credentials needed"}
          {provider.credentials.map((credential) => (
            <span key={credential.name} className="block">
              <code>{credential.name}</code> {credential.state === "set" ? "set" : "not set"}
            </span>
          ))}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge variant={missing === 0 ? "secondary" : "outline"}>{missing === 0 ? "Connected" : "Not connected"}</Badge>
      </ItemActions>
    </Item>
  );
}

function ReviewCorridor({ corridor }: { corridor: FundingCorridorView }) {
  return (
    <Item className="items-start">
      <ItemContent className="min-w-0">
        <ItemTitle truncate="wrap">{corridor.providerName} · {directionLabels[corridor.direction]} · {corridor.regionName}</ItemTitle>
        <p>{customerOutcome(corridor)}</p>
        <ItemDescription lines="wrap">
          <span className="block">
            Credentials: {corridor.credentials.length > 0
              ? corridor.credentials.map((credential, index) => <span key={credential.name}>{index > 0 && ", "}<code>{credential.name}</code> {credential.state === "set" ? "set" : "not set"}</span>)
              : "none needed"}
          </span>
          <span className="block">Evidence: {corridor.confirmedBy ?? "none recorded"}</span>
        </ItemDescription>
      </ItemContent>
    </Item>
  );
}

function CorridorList({ children }: { children: ReactNode }) {
  return (
    <Card size="sm" variant="flush">
      <CardContent inset="list">
        <ul>
          {Children.toArray(children).map((child, index) => (
            <li key={isValidElement(child) ? child.key : index}>
              {index > 0 && <ItemSeparator className="my-0" />}
              {child}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ReviewStep({
  view, turningOn, savedOnWithoutCredentials, pausing, saving, error, onBack, onConfirm,
}: {
  view: FundingOfferingView;
  turningOn: FundingCorridorView[];
  savedOnWithoutCredentials: FundingCorridorView[];
  pausing: FundingCorridorView[];
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const title = turningOn.length > 0
    ? "Review before turning on"
    : pausing.length > 0 ? `Pause ${pausing.length === 1 ? "1 corridor" : `${pausing.length} corridors`}?` : "Save these settings?";
  return (
    <section aria-labelledby="funding-review-heading" className="grid gap-6">
      <div className="grid gap-1">
        <h2 ref={heading} id="funding-review-heading" tabIndex={-1} className="text-lg font-semibold outline-none">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {turningOn.length > 0 ? "Customers can use these as soon as you confirm." : "Nothing changes until you confirm."}
          {view.source === "deployment" && " Saving takes over from the deployment values."}
        </p>
      </div>
      {turningOn.length > 0 && (
        <section aria-labelledby="funding-review-on" className="grid gap-2">
          <h3 id="funding-review-on" className="text-sm font-medium text-muted-foreground">{view.source === "deployment" ? "On after saving" : "Turning on"}</h3>
          <CorridorList>
            {turningOn.map((corridor) => <ReviewCorridor key={corridor.key} corridor={corridor} />)}
          </CorridorList>
        </section>
      )}
      {savedOnWithoutCredentials.length > 0 && (
        <section aria-labelledby="funding-review-without-credentials" className="grid gap-2">
          <h3 id="funding-review-without-credentials" className="text-sm font-medium text-muted-foreground">On without credentials</h3>
          <CorridorList>
            {savedOnWithoutCredentials.map((corridor) => <ReviewCorridor key={corridor.key} corridor={corridor} />)}
          </CorridorList>
          <p className="text-sm text-muted-foreground">These will be saved on and become available when their credentials are set.</p>
        </section>
      )}
      {pausing.length > 0 && (
        <section aria-labelledby="funding-review-off" className="grid gap-2">
          <h3 id="funding-review-off" className="text-sm font-medium text-muted-foreground">Pausing</h3>
          <CorridorList>
            {pausing.map((corridor) => (
              <Item key={corridor.key}>
                <ItemContent className="min-w-0">
                  <ItemTitle truncate="wrap">{corridor.providerName} · {directionLabels[corridor.direction]} · {corridor.regionName}</ItemTitle>
                  <ItemDescription lines="wrap">{corridor.connection === "connected"
                    ? "New orders stop. Existing orders keep working — customers can still check status, withdraw, and recover funds."
                    : "This corridor stays off and won't become available when its credentials return."}</ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </CorridorList>
        </section>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertIcon><CircleAlert /></AlertIcon>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="touch" className="px-4" disabled={saving} onClick={onBack}>Back</Button>
        <Button size="touch" className="px-4" disabled={saving} onClick={onConfirm}>{saving ? "Saving…" : "Confirm"}</Button>
      </div>
    </section>
  );
}

export function FundingSettings({ view, operator }: { view: FundingOfferingView; operator: `0x${string}` }) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [baseView, setBaseView] = useState(view);
  const [draft, setDraft] = useState(() => initialDraft(view));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saveAttempt, setSaveAttempt] = useState<SaveAttempt | null>(null);
  const [lostCredentials, setLostCredentials] = useState<Array<{ key: string; name: string }>>([]);
  const viewRevision = useRef(view.revision);
  useEffect(() => { viewRevision.current = view.revision; }, [view.revision]);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState<SavedSettings | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const nextAttemptId = useRef(0);
  const currentAttempt = useRef<SaveAttempt | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const lostNotice = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const wasReviewing = useRef(false);
  const editedWhileSaving = useRef(new Set<string>());
  const [pendingSave, setPendingSave] = useState(false);
  useLayoutEffect(() => {
    const attempt = currentAttempt.current;
    if (attempt && attempt.submittedRevision < view.revision) currentAttempt.current = null;
  }, [view.revision]);
  const adoptedSelection = (base: FundingOfferingView, corridor: FundingCorridorView) =>
    confirmed && confirmed.revision > base.revision && confirmed.source === "saved"
      ? confirmed.selected[corridor.key] ?? false
      : corridor.selected;
  if (view !== baseView) {
    setBaseView(view);
    const catchUp = pendingSave || Boolean(confirmed && view.revision <= confirmed.revision);
    const lost = view.corridors.filter((corridor) => Boolean(draft[corridor.key]) && !corridorOn(corridor, draft));
    const cleared = lost.filter((corridor) => !adoptedSelection(view, corridor));
    if (view.revision !== baseView.revision && !catchUp) {
      setDraft(initialDraft(view));
      setPendingSave(false);
      setConflictRevision(null);
      setConfirmed(null);
      setNotice(null);
      setSaveAttempt(null);
      setLostCredentials([]);
      setSaving(false);
      setReviewing(false);
      setReviewError(null);
    } else {
      if (view.revision !== baseView.revision) setNotice(null);
      if (cleared.length > 0) {
        setDraft((current) => ({ ...current, ...Object.fromEntries(cleared.map((corridor) => [corridor.key, false])) }));
      }
    }
    if (lost.length > 0) {
      setLostCredentials(lost.map((corridor) => ({ key: corridor.key, name: `${corridor.providerName} · ${directionLabels[corridor.direction]} · ${corridor.regionName}` })));
      if (reviewing) {
        setReviewing(false);
        setSaving(false);
      }
    }
  }

  const effectiveView: FundingOfferingView = confirmed && confirmed.revision > view.revision && confirmed.source === "saved" ? {
    ...view,
    source: confirmed.source,
    revision: confirmed.revision,
    updatedAt: confirmed.updatedAt,
    updatedBy: confirmed.updatedBy,
    corridors: view.corridors.map((corridor) => ({
      ...corridor,
      selected: adoptedSelection(view, corridor),
      offered: adoptedSelection(view, corridor) && corridor.connection === "connected",
      newSinceSave: !Object.hasOwn(confirmed.selected, corridor.key),
    })),
    legacy: view.legacy.map((entry) => entry.state === "in-effect" ? { ...entry, state: "ignored" as const } : entry),
    unknownSaved: [],
  } : view;
  const connected = effectiveView.corridors.filter((corridor) => corridor.connection === "connected");
  const turningOn = connected.filter((corridor) => corridorOn(corridor, draft) && (effectiveView.source === "deployment" || !corridor.selected));
  const savedOnWithoutCredentials = effectiveView.corridors.filter((corridor) => corridor.connection === "not-connected" && corridorOn(corridor, draft));
  const pausing = effectiveView.corridors.filter((corridor) => corridor.selected && !corridorOn(corridor, draft));
  const changed = effectiveView.corridors.filter((corridor) => corridorOn(corridor, draft) !== corridor.selected).length;
  const canSave = (changed > 0 || effectiveView.source === "deployment") && conflictRevision !== effectiveView.revision;

  useEffect(() => {
    if (reviewing) {
      wasReviewing.current = true;
      return;
    }
    if (!returnFocus.current && !wasReviewing.current) return;
    const focusNotice = wasReviewing.current && lostCredentials.length > 0 && !canSave;
    returnFocus.current = false;
    wasReviewing.current = false;
    if (focusNotice) lostNotice.current?.focus();
    else saveButton.current?.focus();
  }, [reviewing, lostCredentials, canSave]);

  const refresh = () => startRefresh(() => router.refresh());
  const startReview = () => {
    setReviewError(null);
    setNotice(null);
    setReviewing(true);
  };
  const leaveReview = () => {
    returnFocus.current = true;
    setReviewing(false);
  };
  const confirm = async () => {
    editedWhileSaving.current = new Set();
    const attempt: SaveAttempt = {
      id: ++nextAttemptId.current,
      revision: view.revision,
      submittedRevision: effectiveView.revision,
      keys: new Set(effectiveView.corridors.filter((corridor) => !corridor.selected && corridorOn(corridor, draft)).map((corridor) => corridor.key)),
      outcome: "in-flight",
    };
    currentAttempt.current = attempt;
    setSaveAttempt(attempt);
    setSaving(true);
    setPendingSave(true);
    setReviewError(null);
    const result = await saveFunding(effectiveView, draft, operator);
    if (currentAttempt.current?.id !== attempt.id) {
      if (currentAttempt.current === null) {
        setSaving(false);
        setPendingSave(false);
        if (result.outcome === "saved") {
          leaveReview();
        } else if (result.outcome === "conflict" || result.outcome === "uncertain") {
          if (result.outcome === "conflict") setConfirmed(null);
          setConflictRevision(result.outcome === "conflict" ? viewRevision.current : null);
          setNotice(result.outcome);
          leaveReview();
        }
      }
      return;
    }
    currentAttempt.current = { ...attempt, outcome: result.outcome };
    setSaveAttempt(currentAttempt.current);
    setSaving(false);
    setPendingSave(false);
    if (result.outcome === "saved") {
      if (result.source === "saved") {
        setConfirmed({ revision: result.revision, source: result.source, updatedAt: result.updatedAt, updatedBy: result.updatedBy, selected: result.selected });
        const untouched = Object.fromEntries(Object.entries(result.selected).filter(([key]) => !editedWhileSaving.current.has(key)));
        editedWhileSaving.current = new Set();
        setDraft((current) => ({ ...current, ...untouched }));
        setNotice("saved");
      }
      leaveReview();
      refresh();
    } else if (result.outcome === "conflict") {
      setConfirmed(null);
      setConflictRevision(viewRevision.current);
      setNotice("conflict");
      leaveReview();
      refresh();
    } else if (result.outcome === "uncertain") {
      setNotice("uncertain");
      leaveReview();
      refresh();
    } else {
      setReviewError(result.message);
    }
  };
  if (reviewing) {
    return <ReviewStep view={effectiveView} turningOn={turningOn} savedOnWithoutCredentials={savedOnWithoutCredentials} pausing={pausing} saving={saving} error={reviewError} onBack={leaveReview} onConfirm={() => void confirm()} />;
  }

  const status = changed === 0
    ? effectiveView.source === "deployment" ? "Not saved yet" : "No unsaved changes"
    : changed === 1 ? "1 unsaved change" : `${changed} unsaved changes`;
  const activeNotice = notice;

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        {activeNotice === "conflict" && (
          <Alert variant="destructive">
            <AlertIcon><CircleAlert /></AlertIcon>
            <AlertTitle>Someone else changed these settings</AlertTitle>
            <AlertDescription>Your changes weren&apos;t saved. Reload the latest settings, then review and save again.</AlertDescription>
            <AlertAction><Button variant="outline" size="touch" className="px-4" onClick={refresh}><RotateCw aria-hidden="true" />Reload</Button></AlertAction>
          </Alert>
        )}
        {activeNotice === "uncertain" && (
          <Alert variant="destructive">
            <AlertIcon><CircleAlert /></AlertIcon>
            <AlertDescription>We couldn&apos;t confirm whether this saved. Reload to check the latest settings.</AlertDescription>
          </Alert>
        )}
        {reviewError && (
          <Alert variant="destructive">
            <AlertIcon><CircleAlert /></AlertIcon>
            <AlertDescription>{reviewError}</AlertDescription>
          </Alert>
        )}
        {lostCredentials.length > 0 && (
          <Alert ref={lostNotice} tabIndex={-1} variant="destructive">
            <AlertIcon><CircleAlert /></AlertIcon>
            <AlertDescription>
              <ul>
                {lostCredentials.map(({ key, name }) => {
                  const outcome = confirmed?.source === "saved" && confirmed.selected[key] === true
                    ? "saved"
                    : saveAttempt?.revision === view.revision && saveAttempt.keys.has(key) ? saveAttempt.outcome : null;
                  return <li key={key}>{name} lost its credentials. {outcome === "saved"
                    ? "That corridor is saved on and will become available when its credentials are set."
                    : outcome === "in-flight" || outcome === "uncertain"
                      ? "A save was already sent, so reload to confirm whether it is saved on."
                      : "Your pending change was cleared."}</li>;
                })}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <SourceBanner view={effectiveView} />
        <LegacyNotices view={effectiveView} />
        {effectiveView.unknownSaved.length > 0 ? (
          <Alert role="note">
            <AlertIcon><CircleAlert /></AlertIcon>
            <AlertTitle>Saved corridors this version no longer offers</AlertTitle>
            <AlertDescription>
              <ul className="grid gap-0.5">
                {effectiveView.unknownSaved.map(({ providerId, region, direction }) => (
                  <li key={`${providerId}:${region}:${direction}`}><code>{providerId}</code> · {region} · {directionLabels[direction]}</li>
                ))}
              </ul>
              <p>They have no effect. Saving removes them.</p>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <section aria-labelledby="funding-corridors-heading" className="grid gap-5">
        <h2 id="funding-corridors-heading" className="text-lg font-semibold">Corridors</h2>
        {effectiveView.corridors.length === 0 && <p className="text-sm text-muted-foreground">This version offers no corridors.</p>}
        {groupByRegion(effectiveView.corridors).map((group) => (
          <section key={group.region} aria-labelledby={`funding-region-${group.region}`} className="grid gap-2">
            <h3 id={`funding-region-${group.region}`} className="text-sm font-medium text-muted-foreground">{group.regionName}</h3>
            <CorridorList>
              {group.corridors.map((corridor) => (
                <CorridorRow
                  key={corridor.key}
                  corridor={corridor}
                  on={corridorOn(corridor, draft)}
                  saved={corridor.selected}
                  onChange={(next) => {
                    if (currentAttempt.current?.outcome === "in-flight") editedWhileSaving.current.add(corridor.key);
                    setNotice((current) => current === "conflict" ? current : null);
                    setLostCredentials([]);
                    setDraft((current) => ({ ...current, [corridor.key]: next }));
                  }}
                />
              ))}
            </CorridorList>
          </section>
        ))}
      </section>

      {effectiveView.providers.length > 0 && (
        <section aria-labelledby="funding-providers-heading" className="grid gap-3">
          <h2 id="funding-providers-heading" className="text-lg font-semibold">Provider connections</h2>
          <CorridorList>
            {effectiveView.providers.map((provider) => <ProviderRow key={provider.providerId} provider={provider} />)}
          </CorridorList>
        </section>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-background py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <p role="status" className="text-sm text-muted-foreground">{activeNotice === "saved" && changed === 0 ? "Saved." : status}</p>
        <div className="flex flex-wrap gap-2">
          {changed > 0 && <Button variant="outline" size="touch" className="px-4" onClick={() => { setDraft(initialDraft(effectiveView)); setLostCredentials([]); }}>Discard</Button>}
          <Button ref={saveButton} size="touch" className="px-4" disabled={!canSave} onClick={startReview}>{turningOn.length > 0 ? "Review and save" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

export function FundingSettingsUnavailable() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  return (
    <Empty role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon"><CircleAlert aria-hidden="true" /></EmptyMedia>
        <EmptyDescription>Settings can&apos;t be read right now. New money in and out is paused until they can.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="touch" className="px-4" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>Try again</Button>
      </EmptyContent>
    </Empty>
  );
}
