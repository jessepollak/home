"use client";

import { AppErrorFallback } from "@/client/home/app-error";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <AppErrorFallback error={error} retry={retry} />;
}
