import styles from "./library.module.css";

export function SectionMessage({ failed = false, children }: { failed?: boolean; children: string }) {
  return <p className={styles.sectionMessage} role={failed ? "alert" : "status"}>{children}</p>;
}
