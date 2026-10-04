"use client";

import type { ComponentProps, RefObject } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import styles from "./primary-navigation.module.css";

export function ShellSearchControl({ close = false, ...props }: ComponentProps<typeof Button> & { close?: boolean }) {
  const Icon = close ? X : Search;
  return <div className={`${styles.glass} relative shrink-0 rounded-full`}>
    <span aria-hidden="true" className={`${styles.floor} pointer-events-none absolute inset-0 rounded-full`} />
    <Button {...props} variant="floating-control" size="shell-control" aria-label={close ? "Close search" : "Search assets"}>
      <Icon className="size-5" aria-hidden="true" />
    </Button>
  </div>;
}

export function ShellSearchField({ inputRef, onInputReady, query, onQueryChange, onComposingChange, maxLength }: {
  inputRef: RefObject<HTMLInputElement | null>;
  onInputReady?: (input: HTMLInputElement | null) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onComposingChange: (value: boolean) => void;
  maxLength: number;
}) {
  return <form role="search" className={`${styles.glass} ${styles.shellSearchField} relative flex min-w-0 flex-1 items-center gap-2 rounded-full px-4`}
    onSubmit={(event) => { event.preventDefault(); inputRef.current?.blur(); }}>
    <span aria-hidden="true" className={`${styles.floor} pointer-events-none absolute inset-0 rounded-full`} />
    <Search className="relative size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <Input ref={(input) => { inputRef.current = input; onInputReady?.(input); }} variant="shell-search" type="text" inputMode="search" aria-label="Search assets" placeholder="Search assets"
      value={query} maxLength={maxLength} onChange={(event) => onQueryChange(event.target.value)}
      onCompositionStart={() => onComposingChange(true)} onCompositionEnd={(event) => { onQueryChange(event.currentTarget.value); onComposingChange(false); }}
      autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" />
    {query ? <Button type="button" variant="ghost" size="touch" className="relative size-11 shrink-0 p-0" aria-label="Clear search"
      onClick={() => { onQueryChange(""); inputRef.current?.focus({ preventScroll: true }); }}><X className="size-4" aria-hidden="true" /></Button> : null}
  </form>;
}
