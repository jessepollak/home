import type { ReactNode } from "react";
import styles from "./finance-rows.module.css";

export type RowExplorerLink = {
  href: string;
  label: string;
  title?: string;
};

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
  explorer?: RowExplorerLink;
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
  explorer,
}: FinanceRowProps) {
  return (
    <li
      className={styles.row}
      data-kind={kind}
      data-has-explorer={explorer ? "true" : "false"}
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
      {explorer ? (
        <a
          className={styles.explorer}
          href={explorer.href}
          target="_blank"
          rel="noreferrer"
          aria-label={explorer.label}
          title={explorer.title}
        >
          <ExplorerIcon />
        </a>
      ) : null}
    </li>
  );
}

function ExplorerIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3h7v7M13 3 5 11" />
      <path d="M11 9v4H3V5h4" />
    </svg>
  );
}
