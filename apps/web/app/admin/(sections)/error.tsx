"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto grid w-full max-w-5xl justify-items-start gap-4" role="alert">
      <p>This section couldn&apos;t load.</p>
      <Button className="min-h-11 px-4" onClick={() => startTransition(() => { router.refresh(); reset(); })}>Try again</Button>
    </div>
  );
}
