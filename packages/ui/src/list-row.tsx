import { useId } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from "react";

export type ListRowTone = "default" | "accent" | "success" | "error" | "muted";

type ListRowBaseProps = Omit<HTMLAttributes<HTMLLIElement>, "children" | "onClick"> & {
  leading: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  /** Interactive rows only: announced as a description after the row content ("View details"). */
  actionHint?: string;
  value: ReactNode;
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
};

type PressableListRowProps = {
  onPress: MouseEventHandler<HTMLButtonElement>;
  href?: never;
  disabled?: ButtonHTMLAttributes<HTMLButtonElement>["disabled"];
  target?: never;
  rel?: never;
  download?: never;
};

type LinkedListRowProps = {
  href: string;
  onPress?: never;
  disabled?: never;
  target?: AnchorHTMLAttributes<HTMLAnchorElement>["target"];
  rel?: AnchorHTMLAttributes<HTMLAnchorElement>["rel"];
  download?: AnchorHTMLAttributes<HTMLAnchorElement>["download"];
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
  actionHint,
  ...rowProps
}: ListRowProps) {
  // Interactive rows keep their content as the accessible name; the action hint is a description.
  const hintId = useId();
  const describedBy = actionHint ? hintId : undefined;
  const content = (
    <>
      <span className="home-ui-list-row__leading">{leading}</span>
      <span className="home-ui-list-row__identity">
        <span className="home-ui-list-row__label">{label}</span>
        {description !== undefined ? (
          <span className="home-ui-list-row__description">{description}</span>
        ) : null}
      </span>
      <span className="home-ui-list-row__value" data-tone={tone}>
        <span className="home-ui-list-row__value-primary">{value}</span>
        {valueDescription !== undefined ? (
          <span className="home-ui-list-row__value-description">{valueDescription}</span>
        ) : null}
      </span>
      {onPress !== undefined || href !== undefined ? (
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
      aria-label={onPress === undefined && href === undefined ? ariaLabel : undefined}
    >
      {rowContent}
    </li>
  );
}
