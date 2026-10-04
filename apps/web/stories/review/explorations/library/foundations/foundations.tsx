import { useState } from "react";
import { ColorPage } from "./color-page";
import { foundationPages, foundations, type FoundationId } from "./model";
import { MotionPage } from "./motion-page";
import { probeThemes, type ThemeValues } from "./probe";
import { RadiusSpacingPage, TypePage } from "./scale-pages";
import styles from "./foundations.module.css";

export function FoundationsSurface({ page, theme }: { page: FoundationId; theme: string }) {
  const [snapshot] = useState<ThemeValues | null>(() => {
    if (typeof document === "undefined") return null;
    const result = probeThemes(foundations.themeNames);
    return result.status === "measured" ? result.values : null;
  });
  const name = foundationPages.find((entry) => entry.id === page)!.name;
  return <div className={styles.surface} data-foundation={page} data-foundation-theme={theme}>
    <div key={page} className={styles.sheet} role="region" aria-label={`${name} reference`}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable references need keyboard access.
      tabIndex={0}>
      <article className={styles.article} aria-labelledby="foundation-title">
        <h2 id="foundation-title" className={styles.title}>{name}</h2>
        {!foundations.sourcesAvailable && page !== "foundations/color" &&
          <p className={styles.note} role="status">Component sources unavailable. Candidate counts cannot be read.</p>}
        {foundations.sourcesAvailable && !foundations.candidatesAvailable && page !== "foundations/color" &&
          <p className={styles.note} role="status">Stylesheets unavailable. Tailwind candidates cannot be confirmed.</p>}
        {page === "foundations/color" && <ColorPage snapshot={snapshot} />}
        {page === "foundations/type" && foundations.sourcesAvailable && foundations.candidatesAvailable && <TypePage />}
        {page === "foundations/radius-spacing" && foundations.sourcesAvailable && foundations.candidatesAvailable && <RadiusSpacingPage />}
        {page === "foundations/motion" && foundations.sourcesAvailable && foundations.candidatesAvailable && <MotionPage />}
      </article>
    </div>
  </div>;
}
