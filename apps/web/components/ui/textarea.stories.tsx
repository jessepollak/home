import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";
import { cn } from "cn";

// Story-only component implementation: the textarea is not consumed by
// production Home surfaces, so it lives inside this story per the design-lane
// convention (docs/design-explorations/README.md). It is not a production
// `components/ui` module.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

const meta = {
  id: "explorations-textarea",
  title: "Explorations/Textarea",
  component: Textarea,
  args: { "aria-label": "Note", placeholder: "Add a note" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Invalid: Story = { args: { "aria-invalid": true } };
