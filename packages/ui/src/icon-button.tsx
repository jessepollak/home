import type { Icon } from "@phosphor-icons/react";
import { Button, type ButtonProps } from "./button";

export type IconButtonProps = Omit<
  ButtonProps,
  "children" | "aria-label" | "aria-labelledby" | "dangerouslySetInnerHTML"
> & {
  /** A concrete, non-empty action name (not the icon's shape). */
  "aria-label": string;
  /** Use Phosphor's SSR exports, available at @home/ui/icons. */
  icon: Icon;
  iconSize?: 20 | 24;
};

export function IconButton({
  icon: IconArtwork,
  iconSize = 20,
  "aria-label": label,
  className,
  variant = "quiet",
  ...props
}: IconButtonProps) {
  if (!label?.trim()) {
    throw new Error("IconButton requires a non-empty aria-label.");
  }

  return (
    <Button
      {...props}
      variant={variant}
      aria-label={label}
      className={["home-ui-icon-button", className].filter(Boolean).join(" ")}
    >
      <IconArtwork size={iconSize} weight="regular" aria-hidden="true" focusable="false" />
    </Button>
  );
}
