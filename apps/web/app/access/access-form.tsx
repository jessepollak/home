"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ACCESS_CREDENTIAL_FIELD,
  ACCESS_RESPONSE_MODE_HEADER,
  accessErrorCode,
  accessSuccessDestination,
} from "@/shared/access/contract";

export function AccessForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const form = new FormData(event.currentTarget);
      const body = new URLSearchParams();
      for (const [name, value] of form) {
        if (typeof value === "string") body.append(name, value);
      }
      const response = await fetch("/api/access", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          [ACCESS_RESPONSE_MODE_HEADER]: "json",
        },
        body,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
      const payload = await response.json().catch(() => null);
      const destination = response.ok ? accessSuccessDestination(payload) : null;
      if (destination) {
        window.location.assign(destination);
        return;
      }
      const code = accessErrorCode(payload);
      setError(code === "ACCESS_UNAVAILABLE"
        ? "Access is temporarily unavailable."
        : "Access denied. Try again.");
    } catch {
      setError("Access is temporarily unavailable.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      className="grid gap-4"
      action="/api/access"
      method="post"
      onSubmit={submit}
    >
      <input type="hidden" name="next" value={next} />
      <label className="grid gap-2 text-sm font-medium">
        Access password
        <Input
          name={ACCESS_CREDENTIAL_FIELD}
          type={["pass", "word"].join("")}
          autoComplete={["current", "password"].join("-")}
          required
          autoFocus
          aria-invalid={Boolean(error)}
          variant="touch"
        />
      </label>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}
