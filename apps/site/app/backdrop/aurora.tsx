import type { BackdropProps } from "./backdrop";
import { AuroraField } from "./aurora/field";
import styles from "./aurora/aurora.module.css";

export function AuroraBackdrop({ region, children }: BackdropProps) {
  if (region === "demo") {
    return (
      <div className={styles.demo}>
        <div aria-hidden="true" className={styles.halo} />
        {children}
      </div>
    );
  }
  const tone = region === "hero" ? styles.hero : `${styles.light} ${styles[region]}`;
  return (
    <div data-aurora-region="" className={tone}>
      <div aria-hidden="true" data-aurora-layer="" className={styles.layer}>
        <div className={styles.still} />
        <AuroraField mode={region} />
        {region === "hero" && <div className={styles.grain} />}
      </div>
      {children}
    </div>
  );
}
