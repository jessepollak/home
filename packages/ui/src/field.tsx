import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

type FieldControlProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
  required?: boolean;
};

export type FieldProps = {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  action?: ReactNode;
  children: ReactElement<FieldControlProps>;
  className?: string;
};

function mergeIds(...values: Array<string | undefined>) {
  return values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []).join(" ") || undefined;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  action,
  children,
  className,
}: FieldProps) {
  const control = Children.only(children);
  if (!isValidElement<FieldControlProps>(control)) {
    throw new Error("Field requires exactly one control element.");
  }

  const hasHint = hint !== undefined && hint !== null && hint !== false;
  const hasError = error !== undefined && error !== null && error !== false;
  const hintId = hasHint ? `${htmlFor}-hint` : undefined;
  const errorId = hasError ? `${htmlFor}-error` : undefined;
  const describedBy = mergeIds(
    control.props["aria-describedby"],
    hintId,
    errorId,
  );
  const wiredControl = cloneElement(control, {
    "aria-describedby": describedBy,
    "aria-invalid": hasError ? true : control.props["aria-invalid"],
    required: required || control.props.required || undefined,
  });

  return (
    <div className={["home-ui-field", className].filter(Boolean).join(" ")}>
      <div className="home-ui-field__label-row">
        <label className="home-ui-field__label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="home-ui-field__required" aria-hidden="true" /> : null}
        </label>
      </div>
      <div className="home-ui-field__control-row">
        {wiredControl}
        {action ? <div className="home-ui-field__action">{action}</div> : null}
      </div>
      {hasHint ? <div className="home-ui-field__hint" id={hintId}>{hint}</div> : null}
      {hasError ? <div className="home-ui-field__error" id={errorId} role="alert">{error}</div> : null}
    </div>
  );
}
