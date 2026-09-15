"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { AppDrawer, MoneyModalBody } from "@/client/money-modal";
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { classifyEmailCodeError } from "./auth-errors";
import {
  BaseAccountLoginError,
  useAccountWallet,
  type BaseAccountLoginPhase,
} from "./cdp-client";
import { SignInEmail } from "./sign-in-email";
import { SignInOtp } from "./sign-in-otp";
import { BaseAccountOnlySignIn } from "./sign-in-base-account";
import { SignInBlockedPanel, SignInStatus } from "./sign-in-shell";

const RESEND_COOLDOWN_SECONDS = 30;

function messageForCodeError(error: unknown): string {
  switch (classifyEmailCodeError(error)) {
    case "invalid": return "That code is not valid. Check the six digits and try again.";
    case "expired": return "That code has expired. Request a new code to continue.";
    default: return "We could not verify that code. Please try again.";
  }
}

function messageForBaseAccountError(error: unknown): string {
  if (!(error instanceof BaseAccountLoginError)) {
    return "Base Account sign-in is unavailable. Your account remains signed out.";
  }
  switch (error.reason) {
    case "cancelled": return "Base Account sign-in was canceled. No session was created.";
    case "account-changed": return "The Base Account changed during sign-in. Reconnect and try again.";
    case "chain-changed": return "The network changed during sign-in. Switch to Base and try again.";
    case "verification-unsupported": return "This Base Account signature could not be verified. Try email or another account.";
    case "disabled": return "Base Account sign-in is not enabled for this deployment.";
    default: return "We could not connect to Base Account. Your account remains signed out.";
  }
}

export { SignInBlockedPanel } from "./sign-in-shell";

function StatusMessage({
  children,
  tone = "neutral",
  role,
  ...props
}: Omit<ComponentProps<typeof Alert>, "children"> & {
  children: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <Alert variant={tone === "error" ? "destructive" : "default"} role={role ?? (tone === "error" ? "alert" : "status")} {...props}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function AccountSignInSheet({
  open,
  onClose,
  onVerified,
}: {
  open: boolean;
  onClose: () => void;
  onVerified?: () => void;
}) {
  const {
    projectConfigured,
    signInAvailability,
    baseAccountEnabled,
    isInitialized,
    status,
    session,
    message,
    requestEmailCode,
    verifyEmailCode,
    signInWithBaseAccount,
    cancelSignInAttempt,
    retrySessionValidation,
    signOut,
  } = useAccountWallet();
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [baseAccountPhase, setBaseAccountPhase] = useState<BaseAccountLoginPhase | null>(null);
  const [completedAttemptSequence, setCompletedAttemptSequence] = useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const baseAccountButtonRef = useRef<HTMLButtonElement>(null);
  const uiAttemptSequence = useRef(0);
  const consumedVerifiedAttempt = useRef<number | null>(null);
  const baseAccountFailed = status === "unavailable" || status === "signout-error" ||
    (status === "signed-out" && message !== null);
  const activeBaseAccountPhase = baseAccountFailed ? null : baseAccountPhase;
  const isBusy = isSendingCode || isVerifyingCode || activeBaseAccountPhase !== null;
  const signInBlocked = signInAvailability === "unconfigured" ||
    signInAvailability === "provider-unavailable";
  const isCleaningUp = !signInBlocked && status === "signing-out";
  const isChecking = !signInBlocked && (status === "restoring" || status === "validating");
  const initialFocusRef = flowId
    ? otpInputRef
    : projectConfigured
      ? emailInputRef
      : baseAccountButtonRef;
  // The sign-in form stays mounted during a pending Base Account attempt; the
  // phase surface lives inside the Base Account button. This status gate covers
  // only cleanup, validation, and error states that replace the form.
  const hasStatus = Boolean(
    isCleaningUp || isChecking || status === "signout-error" || status === "unavailable",
  );

  useEffect(() => {
    if (open && !isInitialized && signInAvailability === "ready") {
      void retrySessionValidation();
    }
  }, [isInitialized, open, retrySessionValidation, signInAvailability]);

  useLayoutEffect(() => {
    if (open && flowId) otpInputRef.current?.focus({ preventScroll: true });
  }, [flowId, open]);

  useEffect(() => {
    if (
      session && status === "verified" && completedAttemptSequence !== null &&
      completedAttemptSequence === uiAttemptSequence.current &&
      consumedVerifiedAttempt.current !== completedAttemptSequence
    ) {
      consumedVerifiedAttempt.current = completedAttemptSequence;
      setBaseAccountPhase(null);
      onClose();
      onVerified?.();
    }
  }, [completedAttemptSequence, onClose, onVerified, session, status]);

  useEffect(() => {
    if (!open || resendAvailableAt === null) return;
    const update = () => setResendSeconds(
      Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000)),
    );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [open, resendAvailableAt]);

  function resetLocalAttempt() {
    uiAttemptSequence.current += 1;
    setCompletedAttemptSequence(null);
    setFlowId(null);
    setOtp("");
    setAuthError(null);
    setIsSendingCode(false);
    setIsVerifyingCode(false);
    setBaseAccountPhase(null);
    setResendAvailableAt(null);
    setResendSeconds(0);
  }

  function closeAndCancelAttempt() {
    if (isBusy || flowId !== null || completedAttemptSequence !== null) cancelSignInAttempt();
    resetLocalAttempt();
    onClose();
  }

  async function sendCode(nextEmail: string) {
    const sequence = ++uiAttemptSequence.current;
    setCompletedAttemptSequence(null);
    setIsSendingCode(true);
    setAuthError(null);
    try {
      const result = await requestEmailCode(nextEmail);
      if (sequence !== uiAttemptSequence.current) return;
      setFlowId(result.flowId);
      setResendAvailableAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    } catch {
      if (sequence === uiAttemptSequence.current) {
        setAuthError("We could not send a code. Check the address and try again.");
      }
    } finally {
      if (sequence === uiAttemptSequence.current) setIsSendingCode(false);
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setAuthError("Enter an email address to continue.");
      return;
    }
    setEmail(normalizedEmail);
    await sendCode(normalizedEmail);
  }

  async function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flowId || !/^\d{6}$/.test(otp)) {
      setAuthError("Enter the six-digit code from your email.");
      return;
    }
    const sequence = uiAttemptSequence.current;
    setIsVerifyingCode(true);
    setAuthError(null);
    try {
      await verifyEmailCode(flowId, otp);
      if (sequence !== uiAttemptSequence.current) return;
      setCompletedAttemptSequence(sequence);
      setOtp("");
      setFlowId(null);
      setResendAvailableAt(null);
    } catch (error) {
      if (sequence === uiAttemptSequence.current) setAuthError(messageForCodeError(error));
    } finally {
      if (sequence === uiAttemptSequence.current) setIsVerifyingCode(false);
    }
  }

  function changeEmail() {
    setFlowId(null);
    setOtp("");
    setAuthError(null);
    setResendAvailableAt(null);
    setResendSeconds(0);
  }

  async function handleBaseAccountSignIn() {
    if (activeBaseAccountPhase !== null) return;
    const sequence = ++uiAttemptSequence.current;
    setCompletedAttemptSequence(null);
    setAuthError(null);
    setBaseAccountPhase("connecting");
    try {
      await signInWithBaseAccount((phase) => {
        if (sequence === uiAttemptSequence.current) setBaseAccountPhase(phase);
      });
      if (sequence === uiAttemptSequence.current) setCompletedAttemptSequence(sequence);
    } catch (error) {
      if (sequence !== uiAttemptSequence.current) return;
      setBaseAccountPhase(null);
      setAuthError(messageForBaseAccountError(error));
    }
  }

  if (!open) return null;

  return (
    <AppDrawer
      open
      labelledBy="account-sign-in-title"
      onCancel={closeAndCancelAttempt}
      initialFocusRef={initialFocusRef}
      immediate
    >
      <DrawerHeader className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center text-left">
        <span />
        <DrawerTitle id="account-sign-in-title" className="text-center">
          {flowId ? "Check your email" : "Sign in to Home"}
        </DrawerTitle>
        <Button
          className="size-11 shrink-0"
          size="icon-lg"
          variant="secondary"
          onClick={closeAndCancelAttempt}
          aria-label="Close sign in"
        >
          <X aria-hidden="true" />
        </Button>
      </DrawerHeader>
      <MoneyModalBody hasFooter={false}>
        {signInBlocked ? (
          <SignInBlockedPanel reason={signInAvailability === "provider-unavailable" ? "provider-unavailable" : "unconfigured"} />
        ) : (
          <>
            {message ? <StatusMessage className="mt-4">{message}</StatusMessage> : null}
            {authError ? <StatusMessage className="mt-4" tone="error" role="alert">{authError}</StatusMessage> : null}
            <SignInStatus
              cleaningUp={isCleaningUp}
              checking={isChecking}
              signOutError={status === "signout-error"}
              unavailable={status === "unavailable"}
              onRetrySignOut={() => void signOut().catch(() => {})}
              onRetryValidation={() => void retrySessionValidation()}
            />
            {hasStatus ? null : !projectConfigured ? (
              baseAccountEnabled ? (
                <BaseAccountOnlySignIn
                  buttonRef={baseAccountButtonRef}
                  phase={activeBaseAccountPhase}
                  onSignIn={() => void handleBaseAccountSignIn()}
                />
              ) : null
            ) : flowId ? (
              <SignInOtp
                email={email}
                otp={otp}
                isSendingCode={isSendingCode}
                isVerifyingCode={isVerifyingCode}
                resendSeconds={resendSeconds}
                inputRef={otpInputRef}
                onOtpChange={setOtp}
                onSubmit={handleOtpSubmit}
                onChangeEmail={changeEmail}
                onResend={() => { setOtp(""); void sendCode(email); }}
              />
            ) : (
              <SignInEmail
                email={email}
                isSendingCode={isSendingCode}
                baseAccountEnabled={baseAccountEnabled}
                baseAccountPhase={activeBaseAccountPhase}
                inputRef={emailInputRef}
                onEmailChange={setEmail}
                onSubmit={handleEmailSubmit}
                onBaseAccountSignIn={() => void handleBaseAccountSignIn()}
              />
            )}
          </>
        )}
      </MoneyModalBody>
    </AppDrawer>
  );
}
