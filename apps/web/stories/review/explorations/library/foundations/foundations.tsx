import { useState, type CSSProperties } from "react";
import { RadioGroup, RadioGroupSegment } from "@/components/ui/radio-group";
import libraryStyles from "../library.module.css";
import { ColorPage } from "./color-page";
import { foundationPages, foundations, type FoundationId } from "./model";
import { MotionPage } from "./motion-page";
import { readThemeValues, type ThemeName, type ThemeValues } from "./probe";
import { RadiusSpacingPage, TypePage } from "./scale-pages";
import styles from "./foundations.module.css";

function themeStyle(snapshot: ThemeValues | null, theme: ThemeName): CSSProperties | undefined {
  if (!snapshot) return undefined;
  return {
    ...Object.fromEntries(Object.entries(snapshot[theme]).filter(([, value]) => value).map(([name, value]) => [`--${name}`, value])),
    colorScheme: theme,
  };
}

export function FoundationsSurface({ page, theme: initialTheme }: { page: FoundationId; theme: string }) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme === "dark" ? "dark" : "light");
  const [snapshot] = useState<ThemeValues | null>(() => typeof document === "undefined" ? null : readThemeValues(foundations.themeNames));
  const name = foundationPages.find((entry) => entry.id === page)!.name;
  return <main className={`${libraryStyles.surface} ${styles.surface}`} aria-label={`${name} foundations`}
    data-foundation={page} data-foundation-theme={theme} style={themeStyle(snapshot, theme)}>
    <div className={libraryStyles.propsBar}>
      <span className={libraryStyles.propField}>
        <span id="foundations-theme-label">Theme</span>
        <RadioGroup variant="segmented" className={styles.themeControl} aria-labelledby="foundations-theme-label"
          value={theme} onValueChange={(value) => setTheme(value === "dark" ? "dark" : "light")}>
          <RadioGroupSegment value="light">Light</RadioGroupSegment>
          <RadioGroupSegment value="dark">Dark</RadioGroupSegment>
        </RadioGroup>
      </span>
    </div>
    <div className={styles.sheet}>
      <article className={styles.article} aria-labelledby="foundation-title">
        <h2 id="foundation-title" className={styles.title}>{name}</h2>
        {page === "foundations/color" && <ColorPage snapshot={snapshot} />}
        {page === "foundations/type" && <TypePage />}
        {page === "foundations/radius-spacing" && <RadiusSpacingPage />}
        {page === "foundations/motion" && <MotionPage />}
      </article>
    </div>
  </main>;
}
