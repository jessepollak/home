"use client";

import Form from "next/form";
import { useEffect, useRef, useState, type FormEvent } from "react";
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

function setSelectValue(select: HTMLSelectElement | null, value: string | null, fallback: string) {
  if (!select) return;
  select.value = value ?? fallback;
  if (select.selectedIndex === -1) select.value = fallback;
}

export function CoverageFilters({ values, issuerOptions, homeOptions }: CoverageFiltersProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const issuerRef = useRef<HTMLSelectElement>(null);
  const homeRef = useRef<HTMLSelectElement>(null);
  const sortRef = useRef<HTMLSelectElement>(null);
  const [initialSearchValue] = useState(values.q);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const syncFiltersFromHistory = () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
      const params = new URL(window.location.href).searchParams;
      if (searchRef.current) searchRef.current.value = params.get("q") ?? "";
      setSelectValue(issuerRef.current, params.get("issuer"), "");
      setSelectValue(homeRef.current, params.get("home"), "");
      setSelectValue(sortRef.current, params.get("sort"), "gdp");
    };
    window.addEventListener("popstate", syncFiltersFromHistory);
    return () => {
      window.removeEventListener("popstate", syncFiltersFromHistory);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (
      searchRef.current
      && document.activeElement !== searchRef.current
      && searchTimerRef.current === null
    ) searchRef.current.value = values.q;
  }, [values.q]);

  useEffect(() => {
    if (document.activeElement !== issuerRef.current) setSelectValue(issuerRef.current, values.issuer, "");
  }, [values.issuer]);

  useEffect(() => {
    if (document.activeElement !== homeRef.current) setSelectValue(homeRef.current, values.home, "");
  }, [values.home]);

  useEffect(() => {
    if (document.activeElement !== sortRef.current) setSelectValue(sortRef.current, values.sort, "gdp");
  }, [values.sort]);

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
    <Form ref={formRef} action="/coverage" scroll={false} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
      <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium">
        Search
        <Input
          ref={searchRef}
          name="q"
          defaultValue={initialSearchValue}
          onInput={scheduleSearch}
          placeholder="Country, code, currency, asset, or issuer"
        />
      </label>
      <label className="flex w-44 flex-col gap-1 text-xs font-medium">
        1:1 onramp
        <NativeSelect ref={issuerRef} name="issuer" defaultValue={values.issuer} onChange={submitNow}>
          <option value="">All</option>
          {issuerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </label>
      <label className="flex w-44 flex-col gap-1 text-xs font-medium">
        Integrated
        <NativeSelect ref={homeRef} name="home" defaultValue={values.home} onChange={submitNow}>
          <option value="">All</option>
          {homeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </label>
      <label className="flex w-44 flex-col gap-1 text-xs font-medium">
        Sort
        <NativeSelect ref={sortRef} name="sort" defaultValue={values.sort} onChange={submitNow}>
          <option value="gdp">GDP, highest first</option>
          <option value="alphabetical">Alphabetical</option>
        </NativeSelect>
      </label>
    </Form>
  );
}
