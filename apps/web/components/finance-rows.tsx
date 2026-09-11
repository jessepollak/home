import type { ReactNode } from "react";
import styles from "./finance-rows.module.css";

type FinanceRowProps = {
  kind: "activity" | "balance" | "asset";
  icon: ReactNode;
  iconTone?: "neutral" | "incoming" | "outgoing" | "self" | "outlined" | "mark";
  label: ReactNode;
  context?: ReactNode;
  contextTitle?: string;
  value: ReactNode;
  valueContext?: ReactNode;
  valueContextTitle?: string;
  valueTone?: "default" | "accent" | "error" | "muted";
  onActivate?: () => void;
  activateLabel?: string;
};

export type ActivityRowProps = Omit<FinanceRowProps, "kind">;
export type BalanceRowProps = Omit<FinanceRowProps, "kind">;
export type AssetRowProps = Omit<FinanceRowProps, "kind">;

export function ActivityRow(props: ActivityRowProps) {
  return <FinanceRow {...props} kind="activity" />;
}

export function BalanceRow(props: BalanceRowProps) {
  return <FinanceRow {...props} kind="balance" />;
}

export function AssetRow(props: AssetRowProps) {
  return <FinanceRow {...props} kind="asset" />;
}

function FinanceRow({
  kind,
  icon,
  iconTone = "neutral",
  label,
  context,
  contextTitle,
  value,
  valueContext,
  valueContextTitle,
  valueTone = "default",
  onActivate,
  activateLabel,
}: FinanceRowProps) {
  const interactive = Boolean(onActivate);
  return (
    <li
      className={styles.row}
      data-kind={kind}
      data-interactive={interactive ? "true" : "false"}
    >
      <span className={styles.icon} data-tone={iconTone} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.identity}>
        <strong>{label}</strong>
        {context ? <small title={contextTitle}>{context}</small> : null}
      </span>
      <span className={styles.value} data-tone={valueTone}>
        <strong>{value}</strong>
        {valueContext ? (
          <small title={valueContextTitle}>{valueContext}</small>
        ) : null}
      </span>
      {interactive ? (
        <>
          <span className={styles.action} aria-hidden="true">›</span>
          <button
            className={styles.rowAction}
            type="button"
            onClick={onActivate}
            aria-label={activateLabel ?? "View details"}
          />
        </>
      ) : null}
    </li>
  );
}
