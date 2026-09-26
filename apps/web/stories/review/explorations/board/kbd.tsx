import type { ComponentProps } from "react";
import styles from "./board.module.css";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd className={className ? `${styles.kbd} ${className}` : styles.kbd} {...props} />;
}

export function Keys({ keys }: { keys: string[] }) {
  return <span className={styles.keys}>
    {keys.map((key, index) => <span key={key} className={styles.keyAlternative}>
      {index > 0 && <span className={styles.keySeparator}>or</span>}
      <Kbd>{key}</Kbd>
    </span>)}
  </span>;
}
