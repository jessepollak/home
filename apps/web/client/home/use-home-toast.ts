"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";

export type HomeToastTone = "neutral" | "success" | "error";
export type HomeToastRole = "status" | "alert";

export type HomeToastOptions = {
  id?: string;
  message: ReactNode;
  tone?: HomeToastTone;
  role?: HomeToastRole;
  duration?: number;
  onClose?: () => void;
};

export function useHomeToast(ownerBoundary: string | null) {
  const previousBoundary = useRef(ownerBoundary);

  useEffect(() => {
    if (previousBoundary.current !== ownerBoundary) {
      toast.close();
      previousBoundary.current = ownerBoundary;
    }
  }, [ownerBoundary]);

  const add = useCallback(({ id, message, tone = "neutral", role = "status", duration = 5_000, onClose }: HomeToastOptions) => {
    return toast.add({
      id,
      title: message,
      type: tone === "neutral" ? "info" : tone,
      priority: role === "alert" ? "high" : "low",
      timeout: duration,
      onClose,
    });
  }, []);

  return { add, closeAll: toast.close };
}
