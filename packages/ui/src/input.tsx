import type { ComponentPropsWithRef, ReactNode } from "react";

export type InputProps = ComponentPropsWithRef<"input"> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
};

export function Input({
  prefix,
  suffix,
  className,
  disabled,
  "aria-invalid": ariaInvalid,
  ...props
}: InputProps) {
  const invalid = ariaInvalid === true || ariaInvalid === "true";
  return (
    <span
      className="home-ui-control home-ui-input surface-primary"
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
    >
      {prefix !== undefined ? <span className="home-ui-control__prefix">{prefix}</span> : null}
      <input
        {...props}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        className={["home-ui-input__control", className].filter(Boolean).join(" ")}
      />
      {suffix !== undefined ? <span className="home-ui-control__suffix">{suffix}</span> : null}
    </span>
  );
}
