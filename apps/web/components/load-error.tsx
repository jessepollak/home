import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function LoadRetryButton({ onRetry, children = "Try again" }: {
  onRetry: () => void;
  children?: ReactNode;
}) {
  return (
    <Button type="button" variant="outline" size="lg" className="h-11" onClick={onRetry}>
      <RotateCw className="size-4" data-icon="inline-start" aria-hidden="true" />
      {children}
    </Button>
  );
}

export function LoadErrorCard({ title, description, tone = "default", role = "alert", onRetry }: {
  title?: ReactNode;
  description?: ReactNode;
  tone?: "default" | "destructive";
  role?: "alert" | "status";
  onRetry: () => void;
}) {
  return (
    <Alert role={role} variant={tone}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {description ? <AlertDescription>{description}</AlertDescription> : null}
      <div className="mt-2 text-foreground"><LoadRetryButton onRetry={onRetry} /></div>
    </Alert>
  );
}
