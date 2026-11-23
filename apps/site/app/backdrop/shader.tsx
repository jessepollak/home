import type { BackdropProps } from "./backdrop";
import { ShaderCanvas } from "./shader/shader-canvas";
import styles from "./shader/shader.module.css";

export function ShaderBackdrop({ region, children }: BackdropProps) {
  if (region === "hero") {
    return (
      <div data-shader-root="" className={`dark ${styles.root}`}>
        <div aria-hidden="true" className={styles.layer}>
          <div className={styles.fallback} />
          <ShaderCanvas placement="hero" />
        </div>
        <div data-shader-copy="" className={styles.copy}>{children}</div>
        <div aria-hidden="true" className={styles.spill} />
      </div>
    );
  }
  if (region === "team" || region === "talk") {
    return (
      <div data-shader-root="" className={styles.echo}>
        <div aria-hidden="true" className={region === "team" ? styles.ribbon : styles.pool}>
          <div className={region === "team" ? styles.ribbonFallback : styles.poolFallback} />
          <ShaderCanvas placement={region} />
        </div>
        {children}
      </div>
    );
  }
  return children;
}
