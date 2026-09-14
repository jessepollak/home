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
  isRegionId,
  presentationRegions,
  countryRegionIds,
  type RegionId,
} from "@/config/regions";

type CountrySelectProps = {
  value: RegionId;
  onValueChange: (regionId: RegionId) => void;
  describedBy: string;
  variant?: "default" | "settings";
};

type CountryOption = {
  value: RegionId;
  label: string;
};

const countryOptions: CountryOption[] = countryRegionIds.map((regionId) => ({
  value: regionId,
  label: presentationRegions[regionId].selectorLabel,
}));

export function CountrySelect({
  value,
  onValueChange,
  describedBy,
  variant = "default",
}: CountrySelectProps) {
  const [open, setOpen] = useState(false);
  const selectedValue = value === "GLOBAL" ? "US" : value;
  const selected =
    countryOptions.find((option) => option.value === selectedValue) ?? countryOptions[0] ?? null;

  return (
    <Combobox
      items={countryOptions}
      value={selected}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(nextValue) => {
        if (nextValue && isRegionId(nextValue.value)) {
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
        <ComboboxEmpty>No countries found.</ComboboxEmpty>
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
