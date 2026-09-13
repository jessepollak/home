"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isRegionId,
  presentationRegions,
  regionIds,
  type RegionId,
} from "@/config/regions";

type CountrySelectProps = {
  value: RegionId;
  onValueChange: (regionId: RegionId) => void;
  describedBy: string;
  variant?: "default" | "settings";
};

export function CountrySelect({
  value,
  onValueChange,
  describedBy,
  variant = "default",
}: CountrySelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (isRegionId(nextValue)) onValueChange(nextValue);
      }}
    >
      <SelectTrigger
        id="country"
        aria-label="Country"
        aria-describedby={describedBy}
        className={
          variant === "settings"
            ? "min-h-11 max-w-full justify-end border-0 bg-transparent p-0 text-right text-country-select font-semibold shadow-none"
            : "min-h-11 w-full bg-background text-country-select font-semibold"
        }
      >
        <SelectValue>
          {(selectedValue) =>
            isRegionId(selectedValue)
              ? presentationRegions[selectedValue].selectorLabel
              : selectedValue
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        sideOffset={6}
        className="max-h-(--home-country-select-max-height) min-w-(--anchor-width) p-1"
        onKeyDownCapture={(event) => {
          if (event.key !== "Home" && event.key !== "End") return;

          const options = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              '[role="option"]:not([data-disabled])',
            ),
          );
          const target = event.key === "Home" ? options[0] : options.at(-1);
          if (!target) return;

          event.preventDefault();
          event.stopPropagation();
          target.focus();
        }}
      >
        {regionIds.map((id) => (
          <SelectItem
            key={id}
            value={id}
            className="min-h-10 py-2 pr-9 pl-3 text-country-select font-semibold"
          >
            {presentationRegions[id].selectorLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
