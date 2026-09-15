"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";

type FilterOption = {
  value: string;
  label: string;
};

type CoverageFiltersProps = {
  values: {
    q: string;
    issuer: string;
    home: string;
    sort: string;
  };
  issuerOptions: readonly FilterOption[];
  homeOptions: readonly FilterOption[];
};

const searchDebounceMs = 250;

export function CoverageFilters({ values, issuerOptions, homeOptions }: CoverageFiltersProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);

  function submitNow() {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    formRef.current?.requestSubmit();
  }

  function scheduleSearch(event: FormEvent<HTMLInputElement>) {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const form = event.currentTarget.form;
    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = null;
      form?.requestSubmit();
    }, searchDebounceMs);
  }

  return (
    <form ref={formRef} method="get" action="/coverage" className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
      <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium">
        Search
        <Input
          name="q"
          defaultValue={values.q}
          onInput={scheduleSearch}
          placeholder="Country, code, currency, or asset"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Issuer route
        <NativeSelect name="issuer" defaultValue={values.issuer} onChange={submitNow}>
          <option value="">All</option>
          {issuerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Home route
        <NativeSelect name="home" defaultValue={values.home} onChange={submitNow}>
          <option value="">All</option>
          {homeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Sort
        <NativeSelect name="sort" defaultValue={values.sort} onChange={submitNow}>
          <option value="gdp">GDP, highest first</option>
          <option value="alphabetical">Alphabetical</option>
        </NativeSelect>
      </label>
    </form>
  );
}
