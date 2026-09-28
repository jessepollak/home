"use client";

import { useEffect, useRef } from "react";

import { Popover } from "@base-ui/react/popover";
import { cva } from "class-variance-authority";

const triggerVariants = cva(
  "inline-flex size-9 items-center justify-center border-0 bg-transparent p-0 text-inherit [font:inherit] whitespace-nowrap before:size-3 before:flex-none before:rounded-full before:bg-muted-foreground before:content-[''] focus-visible:rounded-[0.25rem] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-[3px]",
  {
    variants: {
      tone: {
        Green: "data-[tone=green]:before:bg-status-positive",
        Yellow: "data-[tone=yellow]:before:bg-status-caution",
        Red: "data-[tone=red]:before:bg-status-negative",
      },
      indicator: { solid: "", hollow: "" },
    },
    compoundVariants: [
      {
        tone: "Yellow",
        indicator: "hollow",
        class: "data-[tone=yellow]:data-[indicator=hollow]:before:bg-transparent data-[tone=yellow]:data-[indicator=hollow]:before:shadow-[inset_0_0_0_2px_var(--status-caution)]",
      },
    ],
  },
);

type TrafficStatus = "Green" | "Yellow" | "Red";

type DetailItem = {
  label: string;
  value: string;
  href?: string;
};

type CoverageStatusPreviewProps = {
  status: TrafficStatus;
  accessibleName: string;
  heading: string;
  details: readonly DetailItem[];
  indicatorVariant?: "solid" | "hollow";
  onOpenChange?: (open: boolean) => void;
};

export function CoverageStatusPreview({
  status,
  accessibleName,
  heading,
  details,
  indicatorVariant = "solid",
  onOpenChange,
}: CoverageStatusPreviewProps) {
  const openRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => () => {
    if (openRef.current) onOpenChangeRef.current?.(false);
  }, []);

  function handleOpenChange(open: boolean) {
    openRef.current = open;
    onOpenChange?.(open);
  }

  return (
    <Popover.Root onOpenChange={handleOpenChange}>
      <Popover.Trigger
        aria-label={accessibleName}
        className={triggerVariants({ tone: status, indicator: indicatorVariant })}
        data-indicator={indicatorVariant}
        data-tone={status.toLowerCase()}
        openOnHover
        delay={0}
        render={(props) => <button {...props} type="button" />}
      />
      <Popover.Portal>
        <Popover.Positioner className="z-50 w-[min(22rem,var(--available-width))]" sideOffset={8}>
          <Popover.Popup className="box-border max-h-[var(--available-height)] w-[var(--popup-width,auto)] origin-[var(--transform-origin)] overflow-auto rounded-lg border border-border bg-popover p-[0.875rem] text-popover-foreground shadow-lg transition-[opacity,transform] duration-100 ease-[ease] data-starting-style:opacity-0 data-starting-style:[transform:scale(0.98)] data-ending-style:opacity-0 data-ending-style:[transform:scale(0.98)]">
            <Popover.Arrow className="h-1.5 w-3" />
            {/* oxlint-disable-next-line jsx-a11y/heading-has-content -- Popover.Title supplies the heading content to its rendered element. */}
            <Popover.Title className="m-0 mb-2.5 text-[0.875rem] font-semibold" render={<h3 />}>{heading}</Popover.Title>
            <dl className="m-0 grid gap-[0.45rem] text-[0.8125rem]">
              <div className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-3">
                <dt className="font-medium text-muted-foreground">Traffic color</dt>
                <dd className="m-0 min-w-0 wrap-anywhere">{status}</dd>
              </div>
              {details.map((detail) => (
                <div className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-3" key={detail.label}>
                  <dt className="font-medium text-muted-foreground">{detail.label}</dt>
                  <dd className="m-0 min-w-0 wrap-anywhere">
                    {detail.href ? <a className="underline underline-offset-[0.15em]" href={detail.href}>{detail.value}</a> : detail.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
