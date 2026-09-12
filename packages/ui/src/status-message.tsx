import type { HTMLAttributes, ReactNode } from "react";

export type StatusMessageTone = "neutral" | "success" | "warning" | "error";

export type StatusMessageProps = Omit<HTMLAttributes<HTMLDivElement>, "role" | "title"> & {
  tone?: StatusMessageTone;
  role?: "status" | "alert";
  title?: ReactNode;
  action?: ReactNode;
  visuallyHidden?: boolean;
};

export function StatusMessage({
  tone = "neutral",
  role = "status",
  title,
  action,
  visuallyHidden = false,
  className,
  children,
  ...props
}: StatusMessageProps) {
  return (
    <div
      {...props}
      role={role}
      data-tone={tone}
      data-visually-hidden={visuallyHidden || undefined}
      className={["home-ui-status-message", className].filter(Boolean).join(" ")}
    >
      <div className="home-ui-status-message__content">
        {title === undefined ? null : (
          <strong className="home-ui-status-message__title">{title}</strong>
        )}
        {children === undefined ? null : (
          <div className="home-ui-status-message__body">{children}</div>
        )}
      </div>
      {action === undefined ? null : (
        <div className="home-ui-status-message__action">{action}</div>
      )}
    </div>
  );
}
