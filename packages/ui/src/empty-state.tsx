import type { HTMLAttributes, ReactNode } from "react";

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      {...props}
      className={["home-ui-empty-state", className].filter(Boolean).join(" ")}
    >
      {icon === undefined ? null : (
        <span className="home-ui-empty-state__icon" aria-hidden="true">{icon}</span>
      )}
      <strong className="home-ui-empty-state__title">{title}</strong>
      {description === undefined ? null : (
        <div className="home-ui-empty-state__description">{description}</div>
      )}
      {action === undefined ? null : (
        <div className="home-ui-empty-state__action">{action}</div>
      )}
    </div>
  );
}
