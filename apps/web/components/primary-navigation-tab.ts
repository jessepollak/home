export const navigationTabContentClassName = "flex min-w-0 w-full flex-col items-center justify-center";

export const navigationTabIconClassName = "size-6.75";

export const navigationTabLabelClassName = "block max-w-full truncate text-[0.625rem] leading-3 font-semibold";

export const navigationTabTone = {
  selected: { icon: "text-primary", label: "text-foreground" },
  unselected: { icon: "text-foreground/90", label: "text-foreground/90" },
} as const;
