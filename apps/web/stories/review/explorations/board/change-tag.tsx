import { changeLabel, type BoardFrame } from "./manifest";
import styles from "./board.module.css";

export function ChangeTag({ change }: { change: BoardFrame["change"] }) {
  return <span className={change === "unchanged" ? styles.muted : styles.accent}>{changeLabel(change)}</span>;
}
