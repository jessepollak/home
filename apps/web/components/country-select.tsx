"use client";

import * as RadixSelect from "@radix-ui/react-select";
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
    <RadixSelect.Root
      value={value}
      onValueChange={(nextValue) => {
        if (isRegionId(nextValue)) onValueChange(nextValue);
      }}
    >
      <RadixSelect.Trigger
        id="country"
        aria-label="Country"
        aria-describedby={describedBy}
        className={
          variant === "settings"
            ? "flex min-h-11 items-center justify-end gap-1 border-0 bg-transparent p-0 text-right text-[0.92rem] font-semibold text-[var(--fg)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--home-ui-color-focus)]"
            : "home-ui-select-trigger surface-primary font-semibold data-[state=open]:border-[var(--home-ui-color-action)]"
        }
      >
        <RadixSelect.Value />
        <RadixSelect.Icon aria-hidden="true" className="ml-3 shrink-0 text-[var(--fg-muted)]">
          <ChevronIcon />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
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
          className="surface-primary z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-home-ui-control border border-[var(--separator)] p-1 text-[var(--fg)] shadow-[0_12px_32px_rgba(10,11,13,0.16)]"
        >
          <RadixSelect.ScrollUpButton className="flex h-8 cursor-default items-center justify-center text-[var(--fg-muted)]">
            <ScrollChevronIcon direction="up" />
            <span className="sr-only">Scroll to earlier countries</span>
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="max-h-[min(20rem,var(--radix-select-content-available-height))] overscroll-contain">
            {regionIds.map((id) => (
              <RadixSelect.Item
                key={id}
                value={id}
                className="relative flex min-h-10 w-full cursor-default select-none items-center rounded-home-ui-control py-2 pl-3 pr-9 text-left text-sm font-semibold outline-none data-[highlighted]:bg-[var(--home-ui-color-subtle-hover)] data-[state=checked]:bg-[var(--home-ui-color-subtle-hover)]"
              >
                <RadixSelect.ItemText>
                  {presentationRegions[id].selectorLabel}
                </RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-3 inline-flex items-center text-[var(--home-ui-color-action)]">
                  <CheckIcon />
                  <span className="sr-only">Selected</span>
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex h-8 cursor-default items-center justify-center text-[var(--fg-muted)]">
            <ScrollChevronIcon direction="down" />
            <span className="sr-only">Scroll to later countries</span>
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m8 10 4 4 4-4" />
    </svg>
  );
}

function ScrollChevronIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "up" ? "m8 14 4-4 4 4" : "m8 10 4 4 4-4"} />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
