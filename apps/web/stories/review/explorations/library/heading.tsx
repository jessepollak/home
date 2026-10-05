import styles from "./library.module.css";

export function SurfaceHeading({ id, title, count }: { id?: string; title: string; count?: string }) {
  return <header className={styles.surfaceHeading}>
    <h2 id={id} className={styles.surfaceTitle}>{title}</h2>
    {count && <p className={styles.surfaceCount}>{count}</p>}
  </header>;
}
