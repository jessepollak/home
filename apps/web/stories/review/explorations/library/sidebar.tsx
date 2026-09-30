import { useRef, type KeyboardEvent } from "react";
import { monogram, type LibraryCatalog } from "./catalog";
import styles from "./library.module.css";

function changeSummary(changes: number | null): string | null {
  if (changes === null) return null;
  if (changes === 0) return "No changes";
  return changes === 1 ? "1 change" : `${changes} changes`;
}

export function LibrarySidebar({ catalog, selected, onSelect }: {
  catalog: LibraryCatalog;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const summary = changeSummary(catalog.changes);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = catalog.items.findIndex((item) => item.id === selected);
    const last = catalog.items.length - 1;
    const target = { ArrowDown: Math.min(last, current + 1), ArrowUp: Math.max(0, current - 1), Home: 0, End: last }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = catalog.items[target];
    onSelect(next.id);
    list.current?.querySelector<HTMLElement>(`[data-library-item="${next.id}"]`)?.focus();
  };
  return <nav className={styles.sidebar} aria-labelledby="library-components-heading">
    <header className={styles.sidebarHeader}>
      <h1 id="library-components-heading">Components</h1>
      {summary && <p>{summary}</p>}
    </header>
    <div ref={list} className={styles.list} role="listbox" tabIndex={-1} aria-labelledby="library-components-heading" onKeyDown={move}>
      {catalog.items.map((item) => {
        const active = item.id === selected;
        const kind = item.stories === 1 ? "1 story" : `${item.stories} stories`;
        return <div key={item.id} role="option" aria-selected={active} tabIndex={active ? 0 : -1}
          data-library-item={item.id} className={styles.row}
          aria-label={`${item.name}, ${kind}${item.changed ? ", changed in this build" : ""}`}
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(item.id); }
          }}>
          <span className={styles.tile} aria-hidden="true">{monogram(item.name)}</span>
          <span className={styles.rowText} aria-hidden="true">
            <span className={styles.rowTitle}>{item.name}</span>
            <span className={styles.rowKind}>{kind}</span>
          </span>
          <span className={styles.dot} data-changed={item.changed || undefined} aria-hidden="true" />
        </div>;
      })}
    </div>
  </nav>;
}
