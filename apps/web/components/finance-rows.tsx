import { ListRow, type ListRowTone } from "@home/ui";
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
  valueTone?: ListRowTone;
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
  const leading = (
    <span className={styles.icon} data-tone={iconTone} aria-hidden="true">
      {icon}
    </span>
  );
  const description = context === undefined
    ? undefined
    : <span title={contextTitle}>{context}</span>;
  const valueDescription = valueContext === undefined
    ? undefined
    : <span title={valueContextTitle}>{valueContext}</span>;

  if (onActivate) {
    return (
      <ListRow
        data-kind={kind}
        leading={leading}
        label={label}
        description={description}
        value={value}
        valueDescription={valueDescription}
        tone={valueTone}
        onPress={onActivate}
        aria-label={activateLabel ?? "View details"}
      />
    );
  }

  return (
    <ListRow
      data-kind={kind}
      leading={leading}
      label={label}
      description={description}
      value={value}
      valueDescription={valueDescription}
      tone={valueTone}
    />
  );
}
