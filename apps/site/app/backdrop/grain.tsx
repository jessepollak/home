import type { BackdropProps } from "./backdrop";
import { GrainField } from "./grain/field";
import styles from "./grain/grain.module.css";

export function GrainBackdrop({ region, children }: BackdropProps) {
  return (
    <div className={`${styles.root} ${styles[region]}`}>
      <GrainField region={region} />
      {children}
    </div>
  );
}
