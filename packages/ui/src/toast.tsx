import type { HTMLAttributes, ReactNode } from "react";
import { Button } from "./button";

export type ToastTone = "neutral" | "success" | "warning" | "error";
export type ToastRole = "status" | "alert";

export type ToastViewportProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
};

export function ToastViewport({
  label = "Notifications",
  className,
  children,
  ...props
}: ToastViewportProps) {
  return (
    <div
      {...props}
      aria-label={label}
      aria-live="polite"
      aria-relevant="additions"
      role="region"
      className={["home-ui-toast-viewport", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

type ToastTimer = {
  duration: number;
  onDismiss: () => void;
  timer: ReturnType<typeof setTimeout>;
};

const toastTimers = new WeakMap<HTMLDivElement, ToastTimer>();

function clearToastTimer(node: HTMLDivElement) {
  const current = toastTimers.get(node);
  if (current) clearTimeout(current.timer);
  toastTimers.delete(node);
}

function scheduleToastTimer(node: HTMLDivElement, duration: number, onDismiss: () => void) {
  const current = toastTimers.get(node);
  if (current?.duration === duration) {
    current.onDismiss = onDismiss;
    return;
  }
  clearToastTimer(node);
  if (duration <= 0) return;
  const entry: ToastTimer = {
    duration,
    onDismiss,
    timer: setTimeout(() => {
      toastTimers.delete(node);
      entry.onDismiss();
    }, duration),
  };
  toastTimers.set(node, entry);
}

export type ToastProps = Omit<HTMLAttributes<HTMLDivElement>, "role" | "title"> & {
  tone?: ToastTone;
  role?: ToastRole;
  onDismiss?: () => void;
  /** Milliseconds before dismissal. Set to 0 to keep the toast present. */
  duration?: number;
  action?: ReactNode;
  dismissLabel?: string;
};

export function Toast({
  tone = "neutral",
  role = "status",
  onDismiss,
  duration = 5_000,
  action,
  dismissLabel = "Dismiss notification",
  className,
  children,
  ...props
}: ToastProps) {
  const setToastRef = (node: HTMLDivElement | null) => {
    if (!node || !onDismiss) return;
    scheduleToastTimer(node, duration, onDismiss);
    return () => {
      queueMicrotask(() => {
        if (!node.isConnected) clearToastTimer(node);
      });
    };
  };

  return (
    <div
      {...props}
      ref={setToastRef}
      role={role}
      data-tone={tone}
      className={["home-ui-toast", "surface-primary", className].filter(Boolean).join(" ")}
    >
      <div className="home-ui-toast__message">{children}</div>
      {action === undefined ? null : (
        <div className="home-ui-toast__action">{action}</div>
      )}
      {onDismiss === undefined ? null : (
        <Button
          variant="quiet"
          className="home-ui-toast__dismiss"
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          Dismiss
        </Button>
      )}
    </div>
  );
}
