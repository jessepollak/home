import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-[scale,color,background-color,border-color,opacity,box-shadow] duration-150 active:duration-0 motion-reduce:transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-busy:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80 active:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:active:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 dark:active:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 active:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:active:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline active:underline",
        navigation:
          "rounded-none text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground aria-[current=page]:text-foreground dark:hover:bg-muted/50 dark:active:bg-muted/50",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
        inline:
          "h-auto min-h-0 gap-1 rounded-sm p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "card-action":
          "-mr-2 h-auto min-h-7 gap-1 rounded-md pt-0.5 pr-2 pb-1.5 pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
      },
      press: {
        standard: "active:scale-[0.97] motion-reduce:active:scale-none",
        icon: "active:scale-[0.95] motion-reduce:active:scale-none",
        none: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      press: "standard",
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;
type ButtonPress = NonNullable<VariantProps<typeof buttonVariants>["press"]>;

const iconPressSizes = new Set<ButtonSize>([
  "icon",
  "icon-xs",
  "icon-sm",
  "icon-lg",
]);

const stillPressVariants = new Set<ButtonVariant>([
  "link",
  "navigation",
]);

function defaultButtonPress(variant: ButtonVariant, size: ButtonSize): ButtonPress {
  if (stillPressVariants.has(variant) || size === "inline") return "none";
  return iconPressSizes.has(size) ? "icon" : "standard";
}

function Button({
  className,
  variant = "default",
  size = "default",
  press,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const resolvedVariant = variant ?? "default";
  const resolvedSize = size ?? "default";

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(
        buttonVariants({
          variant: resolvedVariant,
          size: resolvedSize,
          press: press ?? defaultButtonPress(resolvedVariant, resolvedSize),
          className,
        }),
      )}
      {...props}
    />
  );
}

export { Button, buttonVariants };
