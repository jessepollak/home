import { Component, type ReactNode } from "react";
import type { LibraryItem } from "../catalog";
import { foundationPages, type FoundationId } from "../foundations/model";
import { FOUNDATION_ICONS } from "../sidebar";
import { specimens } from "./specimens";
import styles from "./overview.module.css";

class SpecimenBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <p className={styles.message} role="alert">Couldn&apos;t render {this.props.name}.</p>;
    return this.props.children;
  }
}

export function OverviewSurface({ items, onSelect }: { items: LibraryItem[]; onSelect: (id: string) => void }) {
  const count = items.length === 1 ? "1 component" : `${items.length} components`;
  return <div className={styles.surface} data-library-overview="">
    <div className={styles.sheet} role="region" aria-label="All components"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable references need keyboard access.
      tabIndex={0}>
      <article className={styles.article} aria-labelledby="library-overview-title">
        <h2 id="library-overview-title" className={styles.title}>Overview</h2>
        <section className={styles.section} aria-labelledby="library-overview-foundations">
          <h3 id="library-overview-foundations" className={styles.sectionTitle}>Foundations</h3>
          <ul className={styles.foundations}>
            {foundationPages.map((page) => <li key={page.id}>
              <button type="button" className={styles.foundation} onClick={() => onSelect(page.id)}>
                <span className={styles.foundationIcon} aria-hidden="true">{FOUNDATION_ICONS[page.id as FoundationId]}</span>
                <span className={styles.foundationName}>{page.name}</span>
                <span className={styles.kind}>{page.kind}</span>
              </button>
            </li>)}
          </ul>
        </section>
        <section className={styles.section} aria-labelledby="library-overview-components">
          <h3 id="library-overview-components" className={styles.sectionTitle}>
            Components <span className={styles.count}>{count}</span>
          </h3>
          <ul className={styles.grid}>
            {items.map((item) => {
              const specimen = specimens[item.id];
              return <li key={item.id} className={styles.card} data-span={specimen?.span}
                data-library-specimen={item.id}>
                <div className={styles.stage}>
                  {specimen ? <SpecimenBoundary name={item.name}><specimen.Render /></SpecimenBoundary> :
                    <p className={styles.message}>No specimen yet</p>}
                </div>
                <button type="button" className={styles.name} onClick={() => onSelect(item.id)}>
                  {item.name}
                </button>
              </li>;
            })}
          </ul>
        </section>
      </article>
    </div>
  </div>;
}
