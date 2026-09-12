import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "error";

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
};

export function Badge({
  tone = "neutral",
  icon,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={["home-ui-badge", className].filter(Boolean).join(" ")}
      data-tone={tone}
    >
      {icon !== undefined ? (
        <span className="home-ui-badge__icon" aria-hidden="true">{icon}</span>
      ) : null}
      <span className="home-ui-badge__label">{children}</span>
    </span>
  );
}
