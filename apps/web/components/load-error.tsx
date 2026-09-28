import type { ReactNode, Ref } from "react";
import { CircleAlertIcon, RotateCw } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertIcon, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function LoadRetryButton({ onRetry, retryRef, children = "Try again" }: {
  onRetry: () => void;
  retryRef?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}) {
  return (
    <Button ref={retryRef} type="button" variant="outline" size="touch" onClick={onRetry}>
      <RotateCw className="size-4" data-icon="inline-start" aria-hidden="true" />
      {children}
    </Button>
  );
}

export function LoadErrorCard({ title, description, tone = "default", role = "alert", onRetry, retryRef }: {
  title?: ReactNode;
  description?: ReactNode;
  tone?: "default" | "destructive";
  role?: "alert" | "status";
  onRetry: () => void;
  retryRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <Alert role={role} variant={tone}>
      {tone === "destructive" ? <AlertIcon><CircleAlertIcon /></AlertIcon> : null}
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {description ? <AlertDescription>{description}</AlertDescription> : null}
      <AlertAction><LoadRetryButton onRetry={onRetry} retryRef={retryRef} /></AlertAction>
    </Alert>
  );
}
