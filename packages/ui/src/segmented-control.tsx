import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";

export type SegmentedControlItem<Value extends string = string> = {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<Value extends string = string> = Omit<
  HTMLAttributes<HTMLDivElement>,
  "aria-label" | "children" | "onChange" | "role"
> & {
  items: readonly SegmentedControlItem<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  "aria-label": string;
  stretch?: boolean;
};

/**
 * A radio-group presentation for mutually exclusive choices. Selection follows
 * focus for Arrow, Home, and End keys; URL and domain state stay consumer-owned.
 */
export function SegmentedControl<Value extends string>({
  items,
  value,
  onValueChange,
  stretch = false,
  className,
  ...groupProps
}: SegmentedControlProps<Value>) {
  const enabledItems = items.filter((item) => !item.disabled);
  const selectedEnabled = enabledItems.some((item) => item.value === value);
  const fallbackValue = enabledItems[0]?.value;

  const moveSelection = (
    event: KeyboardEvent<HTMLButtonElement>,
    itemIndex: number,
  ) => {
    const enabledIndexes = items.flatMap((item, index) => item.disabled ? [] : [index]);
    if (enabledIndexes.length === 0) return;

    const currentIndex = enabledIndexes.indexOf(itemIndex);
    let targetPosition: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      targetPosition = (currentIndex + 1) % enabledIndexes.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      targetPosition = (currentIndex - 1 + enabledIndexes.length) % enabledIndexes.length;
    } else if (event.key === "Home") {
      targetPosition = 0;
    } else if (event.key === "End") {
      targetPosition = enabledIndexes.length - 1;
    }
    if (targetPosition === null) return;

    event.preventDefault();
    const targetIndex = enabledIndexes[targetPosition]!;
    const target = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
      `[data-segment-index="${targetIndex}"]`,
    );
    target?.focus();
    onValueChange(items[targetIndex]!.value);
  };

  return (
    <div
      {...groupProps}
      className={["home-ui-segmented-control", className].filter(Boolean).join(" ")}
      role="radiogroup"
      data-stretch={stretch ? "true" : "false"}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        const tabbable = selectedEnabled ? selected : item.value === fallbackValue;
        return (
          <button
            key={item.value}
            className="home-ui-segmented-control__item"
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={item.disabled}
            tabIndex={tabbable ? 0 : -1}
            data-segment-index={index}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => moveSelection(event, index)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
