"use client";

import { useEffect, useRef, useState } from "react";
import { AppDrawer, MoneyModalBody, MoneyModalHeader } from "@/client/money-modal";
import { Button } from "@/components/ui/button";
import { ItemSeparator } from "@/components/ui/item";
import { isIdentityConsentLocale, readIdentityVerificationLink, readIdentityVerificationSession, type IdentityVerificationStatus } from "@/shared/identity/contract";
import { IdentityRow } from "./identity-row";
import { sumsubLanguage } from "./sumsub-language";
import { hostedReturnRearmsPolling, identityOwner, useIdentityVerificationStatus, type IdentityWallet } from "./use-identity-verification-status";

export type { IdentityWallet } from "./use-identity-verification-status";
function consentLocale(): string {
  const tag = document.documentElement.lang;
  return isIdentityConsentLocale(tag) ? tag : "en";
}
export type SumsubLoader = () => Promise<typeof import("@sumsub/websdk")>;
type Stage = "consent" | "loading" | "embedded" | "fallback";
const temporaryStatus: IdentityVerificationStatus = {
  state: "temporarily-unavailable", category: "temporarily-unavailable", action: "retry", verifiedAt: null, retryReason: null, supportUrl: null, consentRequired: false,
};
const configurationStatus: IdentityVerificationStatus = {
  ...temporaryStatus, state: "configuration-unavailable", category: "configuration-unavailable", action: "none",
};
const loadSumsub: SumsubLoader = () => import("@sumsub/websdk");
function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}
function errorStatus(error: unknown): number | null {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : null;
}

export function IdentityVerification({ wallet, loadSdk = loadSumsub }: { wallet: IdentityWallet; loadSdk?: SumsubLoader }) {
  const owner = identityOwner(wallet);
  return owner ? <IdentityVerificationForOwner key={owner} wallet={wallet} owner={owner} loadSdk={loadSdk} /> : null;
}

function IdentityVerificationForOwner({ wallet, owner, loadSdk }: { wallet: IdentityWallet; owner: string; loadSdk: SumsubLoader }) {
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const [linkOpenedAt, setLinkOpenedAt] = useState<number | null>(null);
  const query = useIdentityVerificationStatus(wallet, owner, submittedAt);
  const [stage, setStage] = useState<Stage | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [override, setOverride] = useState<IdentityVerificationStatus | null>(null);
  const [linkError, setLinkError] = useState(false);
  const [openingLink, setOpeningLink] = useState(false);
  const attempt = useRef(0);
  const status = override ?? (query.isError ? temporaryStatus : query.data ?? null);
  useEffect(() => {
    if (linkOpenedAt === null) return;
    function rearm() {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (hostedReturnRearmsPolling(linkOpenedAt, now)) setSubmittedAt(now);
    }
    window.addEventListener("focus", rearm);
    document.addEventListener("visibilitychange", rearm);
    return () => {
      window.removeEventListener("focus", rearm);
      document.removeEventListener("visibilitychange", rearm);
    };
  }, [linkOpenedAt]);

  function close() {
    attempt.current += 1;
    setStage(null);
    setToken(null);
    setLinkError(false);
    setOverride(null);
    void query.refetch();
  }
  function open() {
    if (!status) return;
    if (status.state === "temporarily-unavailable") {
      setOverride(null);
      void query.refetch();
      return;
    }
    setStage(status.consentRequired ? "consent" : "loading");
    if (!status.consentRequired) void start(false);
  }
  async function start(consent: boolean) {
    const current = ++attempt.current;
    setStage("loading");
    try {
      const value = await wallet.fetchAccountResource("/api/identity/verification/session", {
        method: "POST", body: consent ? { consent: true, locale: consentLocale() } : {},
      });
      if (current !== attempt.current) return;
      const parsed = readIdentityVerificationSession(value);
      if (!parsed) throw new Error("Identity session unavailable");
      setOverride(null);
      setToken(parsed.token);
      setStage("embedded");
      void query.refetch();
    } catch (error) {
      if (current !== attempt.current) return { ok: false };
      setToken(null);
      setStage(null);
      if (errorStatus(error) === 409 || errorCode(error) === "CONSENT_REQUIRED") {
        setOverride(null);
        void query.refetch();
      } else {
        setOverride(errorCode(error) === "IDENTITY_CONFIGURATION_UNAVAILABLE" ? configurationStatus : temporaryStatus);
      }
      return { ok: false };
    }
  }
  async function openLink() {
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      setLinkError(true);
      return { ok: false };
    }
    tab.opener = null;
    setOpeningLink(true);
    setLinkError(false);
    const current = attempt.current;
    try {
      const value = await wallet.fetchAccountResource("/api/identity/verification/link", { method: "POST", body: {} });
      if (current !== attempt.current) {
        tab.close();
        return;
      }
      const url = readIdentityVerificationLink(value);
      if (!url) throw new Error("Invalid identity link");
      tab.location.replace(url);
      const openedAt = Date.now();
      setLinkOpenedAt(openedAt);
      setSubmittedAt(openedAt);
    } catch (error) {
      tab.close();
      if (current !== attempt.current) return { ok: false };
      if (errorStatus(error) === 409 || errorCode(error) === "CONSENT_REQUIRED") {
        close();
      } else if (errorCode(error) === "IDENTITY_CONFIGURATION_UNAVAILABLE") {
        attempt.current += 1;
        setStage(null);
        setToken(null);
        setLinkError(false);
        setOverride(configurationStatus);
      } else {
        setLinkError(true);
      }
      return { ok: false };
    } finally {
      setOpeningLink(false);
    }
  }

  return (
    <>
      <li><ItemSeparator className="my-0" /><IdentityRow status={status} onAction={open} /></li>
      {stage ? (
        <AppDrawer open labelledBy="identity-sheet-title" onCancel={close} immediate>
          <MoneyModalHeader title="Verify identity" titleId="identity-sheet-title" onClose={close} />
          <MoneyModalBody>
            {stage === "consent" ? (
              <div className="space-y-4 py-4">
                <p className="text-sm">Sumsub collects and holds your ID documents and biometric data. <a className="font-medium text-primary" href="#identity-disclosures" onClick={close}>Disclosures &amp; terms</a></p>
                <Button className="h-11 w-full" size="lg" onClick={() => void start(true)}>Continue</Button>
              </div>
            ) : stage === "loading" ? (
              <p role="status" className="py-4">Opening verification…</p>
            ) : stage === "embedded" && token ? (
              <EmbeddedSumsub token={token} wallet={wallet} loadSdk={loadSdk} onFailure={() => setStage("fallback")} onHint={() => { setSubmittedAt(Date.now()); void query.refetch(); }} />
            ) : (
              <div className="space-y-4 py-4">
                <p className="text-sm">Embedded verification isn&apos;t available. Continue with Sumsub in a new tab.</p>
                <Button className="h-11 w-full" size="lg" disabled={openingLink} onClick={() => void openLink()}>Continue in a new tab</Button>
                {linkError ? <p role="alert">Couldn&apos;t open verification. Please try again.</p> : null}
              </div>
            )}
          </MoneyModalBody>
        </AppDrawer>
      ) : null}
    </>
  );
}

function EmbeddedSumsub({ token, wallet, loadSdk, onFailure, onHint }: {
  token: string; wallet: IdentityWallet; loadSdk: SumsubLoader; onFailure: () => void; onHint: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ wallet, onFailure, onHint });
  useEffect(() => { latest.current = { wallet, onFailure, onHint }; }, [wallet, onFailure, onHint]);
  useEffect(() => {
    let active = true;
    let sdk: import("@sumsub/websdk").SnsWebSdk | null = null;
    const timeout = window.setTimeout(() => { if (active) latest.current.onFailure(); }, 12_000);
    async function launch() {
      try {
        const { default: snsWebSdk } = await loadSdk();
        if (!active || !container.current) return;
        sdk = snsWebSdk.init(token, async () => {
          const value = await latest.current.wallet.fetchAccountResource("/api/identity/verification/session", { method: "POST", body: {} });
          const parsed = readIdentityVerificationSession(value);
          if (!parsed) throw new Error("Identity session unavailable");
          return parsed.token;
        })
          .withConf({ lang: sumsubLanguage(document.documentElement.lang || "en") })
          .withOptions({ addViewportTag: false, adaptIframeHeight: true })
          .on("idCheck.onReady", () => window.clearTimeout(timeout))
          .on("idCheck.onError", () => { if (active) latest.current.onFailure(); })
          .onMessage((type) => { if (active && type === "idCheck.onApplicantSubmitted") latest.current.onHint(); })
          .build();
        sdk.launch(container.current);
      } catch {
        if (active) latest.current.onFailure();
        return { ok: false };
      }
    }
    void launch();
    return () => { active = false; window.clearTimeout(timeout); sdk?.destroy(); };
  }, [token, loadSdk]);
  return <div ref={container} aria-label="Sumsub identity verification" className="min-h-80" />;
}
