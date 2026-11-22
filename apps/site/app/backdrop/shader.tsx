import type { BackdropProps } from "./backdrop";
import { ShaderCanvas } from "./shader/shader-canvas";
import styles from "./shader/shader.module.css";

export function ShaderBackdrop({ region, children }: BackdropProps) {
  if (region !== "hero") return children;
  return (
    <div data-shader-root="" className={`dark ${styles.root}`}>
      <div aria-hidden="true" className={styles.layer}>
        <div className={styles.fallback} />
        <ShaderCanvas />
      </div>
      <div data-shader-copy="" className={styles.copy}>{children}</div>
      <div aria-hidden="true" className={styles.spill} />
    </div>
  );
}
