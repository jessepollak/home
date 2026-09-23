import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";

// Story-only component implementation: the native select is not consumed by
// production Home surfaces, so it lives inside this story per the design-lane
// convention (docs/design-explorations/README.md). It is not a production
// `components/ui` module.
type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative w-fit has-[select:disabled]:opacity-50",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=sm]:h-7 data-[size=sm]:rounded-md data-[size=sm]:py-0.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
        {...props}
      />
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground select-none" aria-hidden="true" data-slot="native-select-icon" />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-background text-foreground", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-background text-foreground", className)}
      {...props}
    />
  )
}

const meta = {
  id: "explorations-native-select",
  title: "Explorations/Native Select",
  component: NativeSelect,
  args: { "aria-label": "Sort coverage" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof NativeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <NativeSelect {...args} defaultValue="gdp">
      <NativeSelectOption value="gdp">GDP</NativeSelectOption>
      <NativeSelectOption value="alphabetical">Alphabetical</NativeSelectOption>
    </NativeSelect>
  ),
};

export const Grouped: Story = {
  render: (args) => (
    <NativeSelect {...args} defaultValue="gdp">
      <NativeSelectOptGroup label="Ranking">
        <NativeSelectOption value="gdp">GDP</NativeSelectOption>
        <NativeSelectOption value="alphabetical">Alphabetical</NativeSelectOption>
      </NativeSelectOptGroup>
    </NativeSelect>
  ),
};
