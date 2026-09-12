import type { ComponentPropsWithRef, ReactNode } from "react";

export type SelectProps = ComponentPropsWithRef<"select"> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
};

export function Select({
  prefix,
  suffix,
  className,
  disabled,
  "aria-invalid": ariaInvalid,
  children,
  ...props
}: SelectProps) {
  const invalid = ariaInvalid === true || ariaInvalid === "true";
  return (
    <span
      className="home-ui-control home-ui-select surface-primary"
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
    >
      {prefix !== undefined ? <span className="home-ui-control__prefix">{prefix}</span> : null}
      <select
        {...props}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        className={["home-ui-select__control", className].filter(Boolean).join(" ")}
      >
        {children}
      </select>
      {suffix !== undefined ? <span className="home-ui-control__suffix">{suffix}</span> : null}
    </span>
  );
}
