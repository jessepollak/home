"use client";

import { useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  presentationRegions,
  countryRegionIds,
  type CountryCode,
  type RegionId,
} from "@/config/regions";

type CountrySelectProps = {
  value: RegionId;
  offered?: readonly CountryCode[];
  onValueChange: (regionId: RegionId) => void;
  describedBy: string;
  variant?: "default" | "settings";
};

type CountryOption = {
  value: RegionId;
  label: string;
};

export function CountrySelect({
  value,
  offered = countryRegionIds,
  onValueChange,
  describedBy,
  variant = "default",
}: CountrySelectProps) {
  const [open, setOpen] = useState(false);
  const countryOptions: CountryOption[] = countryRegionIds.filter((regionId) => offered.includes(regionId)).map((regionId) => ({
    value: regionId,
    label: presentationRegions[regionId].selectorLabel,
  }));
  const selected = countryOptions.find((option) => option.value === value) ?? null;

  return (
    <Combobox
      items={countryOptions}
      value={selected}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(nextValue) => {
        if (nextValue && countryOptions.some((option) => option.value === nextValue.value)) {
          onValueChange(nextValue.value);
          setOpen(false);
        }
      }}
    >
      <ComboboxInput
        aria-label="Country"
        aria-describedby={describedBy}
        placeholder="Search countries"
        className={
          variant === "settings"
            ? "h-11 w-auto min-w-0 max-w-40 [&_[role=combobox]]:min-w-0 [&_[role=combobox]]:text-left"
            : "h-11 w-full"
        }
      />
      <ComboboxContent>
        <ComboboxEmpty>{offered.length === 0 ? "No countries available." : "No countries found."}</ComboboxEmpty>
        <ComboboxList>
          {(option: CountryOption) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
