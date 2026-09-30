import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ActivityIcon, PaletteIcon, RulerIcon, TypeIcon } from "lucide-react";
import { monogram, type LibraryCatalog } from "./catalog";
import { foundationPages, type FoundationId } from "./foundations/model";
import styles from "./library.module.css";

const FOUNDATION_ICONS: Record<FoundationId, ReactNode> = {
  "foundations/color": <PaletteIcon />,
  "foundations/type": <TypeIcon />,
  "foundations/radius-spacing": <RulerIcon />,
  "foundations/motion": <ActivityIcon />,
};

type SidebarRow = { id: string; name: string; kind: string; label: string; tile: ReactNode; changed?: boolean };

function changeSummary(changes: number | null): string | null {
  if (changes === null) return null;
  if (changes === 0) return "No changes";
  return changes === 1 ? "1 change" : `${changes} changes`;
}

export function LibrarySidebar({ catalog, selected, onSelect, onPreload }: {
  catalog: LibraryCatalog;
  selected: string;
  onSelect: (id: string) => void;
  onPreload: (id: string) => void;
}) {
  const foundationRows = foundationPages.map((page) => ({
    id: page.id, name: page.name, kind: page.kind, label: `${page.name}, ${page.kind}`,
    tile: FOUNDATION_ICONS[page.id],
  }));
  const componentRows = catalog.items.map((item) => {
    const kind = item.stories === 1 ? "1 story" : `${item.stories} stories`;
    return {
      id: item.id, name: item.name, kind, changed: item.changed, tile: monogram(item.name),
      label: `${item.name}, ${kind}${item.changed ? ", changed in this build" : ""}`,
    };
  });
  return <nav className={styles.sidebar} aria-label="Library">
    <h1 className={styles.visuallyHidden}>Library</h1>
    <SidebarGroup id="library-foundations-heading" heading="Foundations" rows={foundationRows}
      selected={selected} onSelect={onSelect} />
    <SidebarGroup id="library-components-heading" heading="Components" summary={changeSummary(catalog.changes)}
      rows={componentRows} selected={selected} onSelect={onSelect} onPreload={onPreload} fill />
  </nav>;
}

function SidebarGroup({ id, heading, summary, rows, selected, onSelect, onPreload, fill }: {
  id: string;
  heading: string;
  summary?: string | null;
  rows: SidebarRow[];
  selected: string;
  onSelect: (id: string) => void;
  onPreload?: (id: string) => void;
  fill?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const current = rows.findIndex((row) => row.id === selected);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = rows.length - 1;
    const from = Math.max(0, rows.findIndex((row) => row.id === (event.target as HTMLElement).dataset.libraryItem));
    const target = { ArrowDown: Math.min(last, from + 1), ArrowUp: Math.max(0, from - 1), Home: 0, End: last }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = rows[target];
    onSelect(next.id);
    list.current?.querySelector<HTMLElement>(`[data-library-item="${next.id}"]`)?.focus();
  };
  return <section className={styles.group} data-fill={fill || undefined} aria-labelledby={id}>
    <header className={styles.sidebarHeader}>
      <h2 id={id}>{heading}</h2>
      {summary && <p>{summary}</p>}
    </header>
    <div ref={list} className={styles.list} role="listbox" tabIndex={-1} aria-labelledby={id} onKeyDown={move}>
      {rows.map((row, index) => {
        const active = row.id === selected;
        return <div key={row.id} role="option" aria-selected={active} tabIndex={active || (current === -1 && index === 0) ? 0 : -1}
          data-library-item={row.id} className={styles.row} aria-label={row.label}
          onClick={() => onSelect(row.id)}
          onMouseEnter={() => { onPreload?.(row.id); if (rows[index + 1]) onPreload?.(rows[index + 1].id); }}
          onFocus={() => { onPreload?.(row.id); if (rows[index + 1]) onPreload?.(rows[index + 1].id); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.id); }
          }}>
          <span className={styles.tile} aria-hidden="true">{row.tile}</span>
          <span className={styles.rowText} aria-hidden="true">
            <span className={styles.rowTitle}>{row.name}</span>
            <span className={styles.rowKind}>{row.kind}</span>
          </span>
          {row.changed !== undefined && <span className={styles.dot} data-changed={row.changed || undefined} aria-hidden="true" />}
        </div>;
      })}
    </div>
  </section>;
}
