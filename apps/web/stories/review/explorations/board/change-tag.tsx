import { changeLabel, type BoardFrame } from "./manifest";
import styles from "./board.module.css";

export function ChangeTag({ change }: { change: BoardFrame["change"] }) {
  return change === "unchanged" ? null : <span className={styles.accent}>{changeLabel(change)}</span>;
}
