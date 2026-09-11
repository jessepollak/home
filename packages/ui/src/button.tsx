import type { ComponentPropsWithRef } from "react";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "quiet";
  /** Presentation only. Caller owns asynchronous work and announcements.
   * Blocks native activation and preserves the original accessible name/size.
   */
  loading?: boolean;
};

export function Button({
  type = "button",
  variant = "primary",
  loading = false,
  disabled = false,
  className,
  children,
  "aria-busy": ariaBusy,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? true : ariaBusy}
      data-variant={variant}
      data-loading={loading || undefined}
      className={["home-ui-button isolate", className].filter(Boolean).join(" ")}
    >
      <span className="home-ui-button__label">{children}</span>
      {loading && <span className="home-ui-button__spinner" aria-hidden="true" />}
    </button>
  );
}
