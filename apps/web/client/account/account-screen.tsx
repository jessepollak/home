"use client";

import { Button, Heading, IconButton, Text } from "@home/ui";
import { XIcon } from "@home/ui/icons";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import { classifyEmailCodeError } from "./auth-errors";
import {
  BaseAccountLoginError,
  useAccountWallet,
  type BaseAccountLoginPhase,
} from "./cdp-client";
import {
  CDP_SETUP_DOC_HREF,
  CDP_SETUP_DOC_LABEL,
  signInProviderUnavailableCopy,
  signInUnconfiguredCopy,
} from "./sign-in-copy";
import styles from "./account.module.css";

const RESEND_COOLDOWN_SECONDS = 30;

function messageForCodeError(error: unknown): string {
  switch (classifyEmailCodeError(error)) {
    case "invalid":
      return "That code is not valid. Check the six digits and try again.";
    case "expired":
      return "That code has expired. Request a new code to continue.";
    default:
      return "We could not verify that code. Please try again.";
  }
}

function messageForBaseAccountError(error: unknown): string {
  if (!(error instanceof BaseAccountLoginError)) {
    return "Base Account sign-in is unavailable. Your account remains signed out.";
  }

  switch (error.reason) {
    case "cancelled":
      return "Base Account sign-in was canceled. No session was created.";
    case "account-changed":
      return "The Base Account changed during sign-in. Reconnect and try again.";
    case "chain-changed":
      return "The network changed during sign-in. Switch to Base and try again.";
    case "verification-unsupported":
      return "This Base Account signature could not be verified. Try email or another account.";
    case "disabled":
      return "Base Account sign-in is not enabled for this deployment.";
    default:
      return "We could not connect to Base Account. Your account remains signed out.";
  }
}

function baseAccountPhaseMessage(phase: BaseAccountLoginPhase): string {
  switch (phase) {
    case "connecting":
      return "Connecting to your existing Base Account…";
    case "signing":
      return "Confirm sign-in in Base Account…";
    case "verifying":
      return "Finishing sign-in…";
  }
}

export function SignInBlockedPanel({
  reason,
}: {
  reason: "unconfigured" | "provider-unavailable";
}) {
  if (reason === "unconfigured") {
    return (
      <div className={styles.statusPanel} role="alert">
        <Text as="strong" textStyle="row-label">
          {signInUnconfiguredCopy.heading}
        </Text>
        <Text textStyle="secondary" tone="muted">
          This deployment is missing <code>NEXT_PUBLIC_CDP_PROJECT_ID</code>.
        </Text>
        <Text textStyle="secondary" tone="muted">
          Copy <code>.env.example</code> to <code>apps/web/.env.local</code>, then
          follow{" "}
          <a href={CDP_SETUP_DOC_HREF}>{CDP_SETUP_DOC_LABEL}</a>.
        </Text>
      </div>
    );
  }

  return (
    <div className={styles.statusPanel} role="alert">
      <Text as="strong" textStyle="row-label">
        {signInProviderUnavailableCopy.heading}
      </Text>
      <Text textStyle="secondary" tone="muted">
        {signInProviderUnavailableCopy.body}
      </Text>
    </div>
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
  const [baseAccountPhase, setBaseAccountPhase] =
    useState<BaseAccountLoginPhase | null>(null);
  const [isProviderHandoff, setIsProviderHandoff] = useState(false);
  const [completedAttemptSequence, setCompletedAttemptSequence] =
    useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const uiAttemptSequence = useRef(0);
  const consumedVerifiedAttempt = useRef<number | null>(null);
  const baseAccountFailed =
    status === "unavailable" ||
    status === "signout-error" ||
    (status === "signed-out" && message !== null);
  const activeBaseAccountPhase = baseAccountFailed ? null : baseAccountPhase;
  const isBusy =
    isSendingCode || isVerifyingCode || activeBaseAccountPhase !== null;
  const signInBlocked =
    signInAvailability === "unconfigured" ||
    signInAvailability === "provider-unavailable";
  const isCleaningUp = !signInBlocked && status === "signing-out";
  const isChecking =
    !signInBlocked && (status === "restoring" || status === "validating");

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      const initialFocus = dialog.querySelector<HTMLElement>(
        "[data-initial-focus]:not(:disabled), button:not(:disabled)",
      );
      initialFocus?.focus();
      return;
    }

    if (!open && dialog.open) {
      dialog.close();
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    }
  }, [open]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !flowId || !dialog?.open) return;
    dialog.querySelector<HTMLElement>("[data-initial-focus]:not(:disabled)")?.focus();
  }, [flowId, open]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !isProviderHandoff || !baseAccountFailed || !dialog || dialog.open) {
      return;
    }
    dialog.showModal();
    dialog.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [baseAccountFailed, isProviderHandoff, open]);

  useEffect(() => {
    if (!open || (isProviderHandoff && !baseAccountFailed)) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [baseAccountFailed, isProviderHandoff, open]);

  useEffect(() => {
    if (
      session &&
      status === "verified" &&
      completedAttemptSequence !== null &&
      completedAttemptSequence === uiAttemptSequence.current &&
      consumedVerifiedAttempt.current !== completedAttemptSequence
    ) {
      consumedVerifiedAttempt.current = completedAttemptSequence;
      onClose();
      onVerified?.();
    }
  }, [completedAttemptSequence, onClose, onVerified, session, status]);

  useEffect(() => {
    if (!open || resendAvailableAt === null) {
      return;
    }

    const update = () => {
      setResendSeconds(
        Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000)),
      );
    };
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
    setIsProviderHandoff(false);
    setResendAvailableAt(null);
    setResendSeconds(0);
  }

  function closeAndCancelAttempt() {
    if (isBusy || flowId !== null || completedAttemptSequence !== null) {
      cancelSignInAttempt();
    }
    resetLocalAttempt();
    if (!dialogRef.current?.open) {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    }
    onClose();
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    closeAndCancelAttempt();
  }

  function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) {
      closeAndCancelAttempt();
    }
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
      if (sequence !== uiAttemptSequence.current) return;
      setAuthError("We could not send a code. Check the address and try again.");
    } finally {
      if (sequence === uiAttemptSequence.current) {
        setIsSendingCode(false);
      }
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
      if (sequence !== uiAttemptSequence.current) return;
      setAuthError(messageForCodeError(error));
    } finally {
      if (sequence === uiAttemptSequence.current) {
        setIsVerifyingCode(false);
      }
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
    const sequence = ++uiAttemptSequence.current;
    setCompletedAttemptSequence(null);
    setAuthError(null);
    setBaseAccountPhase("connecting");
    setIsProviderHandoff(true);
    dialogRef.current?.close();
    try {
      await signInWithBaseAccount((phase) => {
        if (sequence === uiAttemptSequence.current) {
          setBaseAccountPhase(phase);
        }
      });
      if (sequence !== uiAttemptSequence.current) return;
      setCompletedAttemptSequence(sequence);
    } catch (error) {
      if (sequence !== uiAttemptSequence.current) return;
      setBaseAccountPhase(null);
      setIsProviderHandoff(false);
      setAuthError(messageForBaseAccountError(error));
      const dialog = dialogRef.current;
      if (open && dialog && !dialog.open) {
        dialog.showModal();
        dialog.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
      }
    }
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        className={styles.sheet}
        aria-labelledby="account-sign-in-title"
        onCancel={handleCancel}
        onClick={handleDialogClick}
      >
        <div className={styles.sheetHeader}>
          <Heading
            level={2}
            textStyle="sheet-title"
            id="account-sign-in-title"
          >
            {flowId ? "Check your email" : "Sign in to Home"}
          </Heading>
          <IconButton
            className={styles.closeButton}
            icon={XIcon}
            variant="secondary"
            onClick={closeAndCancelAttempt}
            aria-label="Close sign in"
          />
        </div>

        {signInBlocked ? (
          <SignInBlockedPanel
            reason={
              signInAvailability === "provider-unavailable"
                ? "provider-unavailable"
                : "unconfigured"
            }
          />
        ) : (
          <>
            {message ? (
              <Text
                className={styles.notice}
                textStyle="secondary"
                role="status"
              >
                {message}
              </Text>
            ) : null}
            {authError ? (
              <Text
                className={styles.error}
                textStyle="secondary"
                role="alert"
              >
                {authError}
              </Text>
            ) : null}

            {activeBaseAccountPhase && !isProviderHandoff ? (
              <div className={styles.pendingPanel} aria-live="polite">
                <span className={styles.spinner} aria-hidden="true" />
                <Text as="span" textStyle="secondary" tone="muted">
                  {baseAccountPhaseMessage(activeBaseAccountPhase)}
                </Text>
              </div>
            ) : isCleaningUp ? (
              <div className={styles.pendingPanel} aria-live="polite">
                <span className={styles.spinner} aria-hidden="true" />
                <Text as="span" textStyle="secondary" tone="muted">
                  Finishing sign-out…
                </Text>
              </div>
            ) : isChecking ? (
              <div className={styles.pendingPanel} aria-live="polite">
                <span className={styles.spinner} aria-hidden="true" />
                <Text as="span" textStyle="secondary" tone="muted">
                  Verifying your session…
                </Text>
              </div>
            ) : status === "signout-error" ? (
              <div className={styles.statusPanel} role="alert">
                <Text as="strong" textStyle="row-label">
                  Sign-out did not finish.
                </Text>
                <Text textStyle="secondary" tone="muted">
                  Your account details remain hidden.
                </Text>
                <Button
                  className={styles.statusAction}
                  variant="secondary"
                  onClick={() => void signOut().catch(() => {})}
                >
                  Retry sign out
                </Button>
              </div>
            ) : status === "unavailable" ? (
              <div className={styles.statusPanel} role="alert">
                <Text as="strong" textStyle="row-label">
                  We could not verify this session.
                </Text>
                <Text textStyle="secondary" tone="muted">
                  Your account details remain hidden.
                </Text>
                <Button
                  className={styles.statusAction}
                  variant="secondary"
                  onClick={() => void retrySessionValidation()}
                >
                  Try again
                </Button>
              </div>
            ) : !projectConfigured && baseAccountEnabled ? (
              <div className={styles.form}>
                <Button
                  className={styles.formAction}
                  variant="secondary"
                  onClick={() => void handleBaseAccountSignIn()}
                  autoFocus
                  data-initial-focus
                >
                  Sign in with Base Account
                </Button>
              </div>
            ) : projectConfigured && flowId ? (
              <form className={styles.form} onSubmit={handleOtpSubmit}>
                <div className={styles.fieldHeader}>
                  <label htmlFor="account-otp">Verification code</label>
                  <Button
                    className={styles.changeEmailButton}
                    variant="quiet"
                    onClick={changeEmail}
                    disabled={isVerifyingCode || isSendingCode}
                  >
                    Change email
                  </Button>
                </div>
                <input
                  id="account-otp"
                  className={styles.otpInput}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(event) =>
                    setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={isVerifyingCode}
                  aria-describedby="account-otp-help"
                  autoFocus
                  data-initial-focus
                />
                <Text
                  id="account-otp-help"
                  className={styles.fieldHelp}
                  textStyle="metadata"
                  tone="muted"
                >
                  Sent to {email}. Codes expire.
                </Text>
                <Button
                  className={styles.formAction}
                  type="submit"
                  disabled={isVerifyingCode || otp.length !== 6}
                >
                  {isVerifyingCode ? "Verifying…" : "Verify and continue"}
                </Button>
                <Button
                  className={styles.formAction}
                  variant="secondary"
                  onClick={() => {
                    setOtp("");
                    void sendCode(email);
                  }}
                  disabled={isSendingCode || resendSeconds > 0}
                >
                  {isSendingCode
                    ? "Sending…"
                    : resendSeconds > 0
                      ? `Resend code in ${resendSeconds}s`
                      : "Resend code"}
                </Button>
              </form>
            ) : projectConfigured ? (
              <form className={styles.form} onSubmit={handleEmailSubmit}>
                <label htmlFor="account-email">Email address</label>
                <input
                  id="account-email"
                  className={styles.input}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isSendingCode}
                  required
                  autoFocus
                  data-initial-focus
                />
                <Button
                  className={styles.formAction}
                  type="submit"
                  disabled={isSendingCode}
                >
                  {isSendingCode ? "Sending code…" : "Continue with email"}
                </Button>
                {baseAccountEnabled ? (
                  <>
                    <div className={styles.signInDivider} role="separator">
                      <Text as="span" textStyle="metadata" tone="muted">
                        or
                      </Text>
                    </div>
                    <Button
                      className={styles.formAction}
                      variant="secondary"
                      onClick={() => void handleBaseAccountSignIn()}
                    >
                      Sign in with Base Account
                    </Button>
                  </>
                ) : null}
              </form>
            ) : null}
          </>
        )}
      </dialog>
      {open && isProviderHandoff && !baseAccountFailed ? (
        <aside
          className={styles.providerHandoff}
          aria-live="polite"
          role="status"
        >
          {activeBaseAccountPhase ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              <Text textStyle="secondary" tone="muted">
                {baseAccountPhaseMessage(activeBaseAccountPhase)}
              </Text>
            </>
          ) : null}
          <Button
            className={styles.providerAction}
            variant="secondary"
            onClick={closeAndCancelAttempt}
          >
            Cancel sign in
          </Button>
        </aside>
      ) : null}
    </>
  );
}
