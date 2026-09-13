import { useId } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from "react";

export type ListRowTone = "default" | "accent" | "success" | "error" | "muted";

type ListRowBaseProps = Omit<
  HTMLAttributes<HTMLLIElement>,
  "aria-checked" | "children" | "onClick" | "role"
> & {
  /** Optional; when omitted the identity spans the leading track (no `display:none` needed). */
  leading?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  /** Interactive rows only: announced as a description after the row content ("View details"). */
  actionHint?: string;
  value?: ReactNode;
  valueDescription?: ReactNode;
  tone?: ListRowTone;
};

type StaticListRowProps = {
  onPress?: never;
  href?: never;
  disabled?: never;
  target?: never;
  rel?: never;
  download?: never;
  role?: never;
  "aria-checked"?: never;
  name?: never;
};

type PressableListRowProps = {
  onPress: MouseEventHandler<HTMLButtonElement>;
  href?: never;
  disabled?: ButtonHTMLAttributes<HTMLButtonElement>["disabled"];
  target?: never;
  rel?: never;
  download?: never;
  role?: "radio";
  "aria-checked"?: ButtonHTMLAttributes<HTMLButtonElement>["aria-checked"];
  name?: ButtonHTMLAttributes<HTMLButtonElement>["name"];
};

type LinkedListRowProps = {
  href: string;
  onPress?: never;
  disabled?: never;
  target?: AnchorHTMLAttributes<HTMLAnchorElement>["target"];
  rel?: AnchorHTMLAttributes<HTMLAnchorElement>["rel"];
  download?: AnchorHTMLAttributes<HTMLAnchorElement>["download"];
  role?: never;
  "aria-checked"?: never;
  name?: never;
};

export type ListRowProps = ListRowBaseProps &
  (StaticListRowProps | PressableListRowProps | LinkedListRowProps);

export function ListRow({
  leading,
  label,
  description,
  value,
  valueDescription,
  tone = "default",
  onPress,
  href,
  disabled,
  target,
  rel,
  download,
  className,
  "aria-label": ariaLabel,
  "aria-checked": ariaChecked,
  actionHint,
  role,
  name,
  ...rowProps
}: ListRowProps) {
  // Interactive rows keep their content as the accessible name; the action hint is a description.
  const hintId = useId();
  const describedBy = actionHint ? hintId : undefined;
  const content = (
    <>
      {leading !== undefined ? <span className="home-ui-list-row__leading">{leading}</span> : null}
      <span className="home-ui-list-row__identity">
        <span className="home-ui-list-row__label">{label}</span>
        {description !== undefined ? (
          <span className="home-ui-list-row__description">{description}</span>
        ) : null}
      </span>
      {value !== undefined ? (
        <span className="home-ui-list-row__value" data-tone={tone}>
          <span className="home-ui-list-row__value-primary">{value}</span>
          {valueDescription !== undefined ? (
            <span className="home-ui-list-row__value-description">{valueDescription}</span>
          ) : null}
        </span>
      ) : null}
      {(onPress !== undefined || href !== undefined) && role !== "radio" ? (
        <span className="home-ui-list-row__indicator" aria-hidden="true">›</span>
      ) : null}
    </>
  );

  let rowContent: ReactNode;
  if (onPress !== undefined) {
    rowContent = (
      <button
        className="home-ui-list-row__content home-ui-list-row__control"
        type="button"
        onClick={onPress}
        disabled={disabled}
        role={role}
        aria-checked={ariaChecked}
        name={name}
        aria-describedby={describedBy}
      >
        {content}
        {actionHint ? <span id={hintId} hidden>{actionHint}</span> : null}
      </button>
    );
  } else if (href !== undefined) {
    rowContent = (
      <a
        className="home-ui-list-row__content home-ui-list-row__control"
        href={href}
        target={target}
        rel={rel}
        download={download}
        aria-describedby={describedBy}
      >
        {content}
        {actionHint ? <span id={hintId} hidden>{actionHint}</span> : null}
      </a>
    );
  } else {
    rowContent = <div className="home-ui-list-row__content">{content}</div>;
  }

  return (
    <li
      {...rowProps}
      className={["home-ui-list-row", className].filter(Boolean).join(" ")}
      data-interactive={onPress !== undefined || href !== undefined ? "true" : "false"}
      data-has-value={value !== undefined ? "true" : "false"}
      data-has-leading={leading !== undefined ? "true" : "false"}
      data-selection={role === "radio" ? "true" : undefined}
      aria-label={onPress === undefined && href === undefined ? ariaLabel : undefined}
    >
      {rowContent}
    </li>
  );
}
