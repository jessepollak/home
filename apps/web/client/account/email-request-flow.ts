"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMAIL_REQUEST_VERSION,
  parseEmailRequestClaimResponse,
  parseEmailRequestWriteResponse,
  type EmailRequestAnyWrite,
} from "@/shared/account/contracts/email-request";
import type { AccountResourceOptions } from "./cdp-client";
import type { EmailRequestResult, SignInEmailCapability } from "./base-account-connector";

const EMAIL_REQUEST_PATH = "/api/account/email-request";
const ANSWERED_HINT_KEY = "home:email-request-answered";
const SAVE_RETRY_DELAYS_MS = [500, 1500, 4000];

export type SignInEmailFollowUp = SignInEmailCapability | { status: "skipped" };

type EmailRequestPrompt = {
  pending: boolean;
  share: () => void;
  dismiss: () => void;
};

type FetchResource = (path: string, options?: AccountResourceOptions) => Promise<unknown>;
type Wait = (ms: number) => Promise<void>;
type WriteBody = EmailRequestAnyWrite extends infer T ? T extends unknown ? Omit<T, "version" | "address"> : never : never;
type ScopedWriter = {
  send: (body: WriteBody) => Promise<unknown>;
  stillCurrent: () => boolean;
  stillCurrentOwner: () => boolean;
};

const defaultWait: Wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function readEmailRequestAnsweredHint(): boolean {
  try {
    return window.localStorage.getItem(ANSWERED_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAnsweredHint() {
  try {
    window.localStorage.setItem(ANSWERED_HINT_KEY, "1");
  } catch { // oxlint-disable-line home/no-silent-catch -- local hints are best-effort; the server marker stays authoritative
  }
}

async function persistWrite(writer: ScopedWriter, body: WriteBody, wait: Wait): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    if (!writer.stillCurrentOwner()) return false;
    try {
      if (parseEmailRequestWriteResponse(await writer.send(body))) return true;
    } catch {
    }
    if (attempt >= SAVE_RETRY_DELAYS_MS.length) return false;
    await wait(SAVE_RETRY_DELAYS_MS[attempt]);
  }
}

export function useEmailRequestFlow({
  ready,
  ownerKey,
  accountAddress,
  captureGeneration,
  isGenerationCurrent,
  followUp,
  takeFollowUp,
  requestEmail,
  fetchResource,
  wait = defaultWait,
}: {
  ready: boolean;
  ownerKey: string | null;
  accountAddress: string | null;
  captureGeneration: () => number;
  isGenerationCurrent: (generation: number) => boolean;
  followUp: number;
  takeFollowUp: () => SignInEmailFollowUp | null;
  requestEmail: () => Promise<EmailRequestResult> | null;
  fetchResource: FetchResource;
  wait?: Wait;
}): EmailRequestPrompt {
  const [pendingOwner, setPendingOwner] = useState<string | null>(null);
  if (pendingOwner !== null && pendingOwner !== ownerKey) setPendingOwner(null);
  const fetchRef = useRef(fetchResource);
  const readyRef = useRef(ready);
  const ownerRef = useRef(ownerKey);
  const addressRef = useRef(accountAddress);
  useEffect(() => {
    fetchRef.current = fetchResource;
    readyRef.current = ready;
    ownerRef.current = ownerKey;
    addressRef.current = accountAddress;
  }, [accountAddress, fetchResource, ownerKey, ready]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isCurrentOwner = useCallback((owner: string) =>
    mountedRef.current && readyRef.current && ownerRef.current === owner, []);
  const isCurrentOwnerGeneration = useCallback((owner: string) =>
    mountedRef.current && ownerRef.current === owner, []);

  const writerFor = useCallback((owner: string): ScopedWriter => {
    const send = fetchRef.current;
    const generation = captureGeneration();
    const address = addressRef.current;
    return {
      send: (body) => send(EMAIL_REQUEST_PATH, { method: "POST", body: { version: EMAIL_REQUEST_VERSION, ...body, address } }),
      stillCurrent: () => isCurrentOwner(owner) && isGenerationCurrent(generation),
      stillCurrentOwner: () => isCurrentOwnerGeneration(owner) && isGenerationCurrent(generation),
    };
  }, [captureGeneration, isCurrentOwner, isCurrentOwnerGeneration, isGenerationCurrent]);

  useEffect(() => {
    if (!ready || !ownerKey) return;
    const next = takeFollowUp();
    if (!next) return;
    const owner = ownerKey;
    const writer = writerFor(owner);

    const offerShareStep = async () => {
      if (!writer.stillCurrent()) return;
      let response: unknown = null;
      try {
        response = await writer.send({ kind: "claim", channel: "share_step" });
      } catch {
      }
      if (writer.stillCurrentOwner() && parseEmailRequestClaimResponse(response)?.claimed === true) setPendingOwner(owner);
    };
    switch (next.status) {
      case "email":
        void persistWrite(writer, { kind: "email", channel: "sign_in", email: next.email }, wait).then((saved) => {
          if (saved) writeAnsweredHint();
        });
        break;
      case "declined":
        void persistWrite(writer, { kind: "answer", channel: "sign_in", answer: "declined" }, wait).then((saved) => {
          if (saved) writeAnsweredHint();
        });
        break;
      case "ignored":
      case "refused":
        void persistWrite(writer, {
          kind: "sign_in_capability",
          result: next.status,
          ...(next.status === "refused" && next.code !== null ? { walletCode: next.code } : {}),
          ...(next.status === "refused" && next.message !== null ? { walletMessage: next.message } : {}),
        }, wait).then(offerShareStep);
        break;
      case "skipped":
        void offerShareStep();
        break;
    }
  }, [followUp, ownerKey, ready, takeFollowUp, wait, writerFor]);

  const pending = ready && ownerKey !== null && pendingOwner === ownerKey;

  const share = useCallback(() => {
    if (!pending || ownerKey === null) return;
    setPendingOwner(null);
    writeAnsweredHint();
    const writer = writerFor(ownerKey);
    void persistWrite(writer, { kind: "asked", channel: "share_step" }, wait);
    const result = requestEmail();
    if (!result) {
      void persistWrite(writer, { kind: "answer", channel: "share_step", answer: "failed" }, wait);
      return;
    }
    void result.then((outcome) => {
      if (!writer.stillCurrentOwner()) return;
      if (outcome.status === "email") {
        void persistWrite(writer, {
          kind: "email",
          channel: "share_step",
          email: outcome.email,
          ...(outcome.bundleId ? { bundleId: outcome.bundleId } : {}),
        }, wait);
        return;
      }
      if (outcome.status === "declined") {
        void persistWrite(writer, { kind: "answer", channel: "share_step", answer: "declined" }, wait);
        return;
      }
      void persistWrite(writer, {
        kind: "answer",
        channel: "share_step",
        answer: "failed",
        ...(outcome.code !== null ? { walletCode: outcome.code } : {}),
        ...(outcome.message !== null ? { walletMessage: outcome.message } : {}),
      }, wait);
    });
  }, [ownerKey, pending, requestEmail, wait, writerFor]);

  const dismiss = useCallback(() => {
    if (!pending || ownerKey === null) return;
    setPendingOwner(null);
    writeAnsweredHint();
    void persistWrite(writerFor(ownerKey), { kind: "answer", channel: "share_step", answer: "not_now" }, wait);
  }, [ownerKey, pending, wait, writerFor]);

  return { pending, share, dismiss };
}
