import type { BackdropProps } from "./backdrop";
import { DimensionalScene } from "./dimensional/scene";
import styles from "./dimensional/dimensional.module.css";

export function DimensionalBackdrop({ region, children }: BackdropProps) {
  if (region === "hero") {
    return (
      <div className={styles.hero}>
        <DimensionalScene />
        <div className={styles.copy}>{children}</div>
      </div>
    );
  }
  if (region === "customers") return <div className={styles.lift}>{children}</div>;
  return children;
}
