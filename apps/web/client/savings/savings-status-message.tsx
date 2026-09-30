"use client";

import { type ComponentProps, type ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertIcon, AlertDescription } from "@/components/ui/alert";

export function StatusMessage({
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
      {tone === "error" ? <AlertIcon><CircleAlertIcon /></AlertIcon> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
