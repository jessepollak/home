"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { SupportedGlobeProps } from "./supported-globe";
import styles from "./supported-globe.module.css";

const DynamicSupportedGlobe = dynamic(
  () => import("./supported-globe").then((module) => module.SupportedGlobe),
  { ssr: false, loading: () => <SupportedGlobeFallback /> },
);

function SupportedGlobeFallback({
  observeRef,
  ariaLabel = "World with illustrative money connections",
}: {
  observeRef?: (node: HTMLElement | null) => void;
  ariaLabel?: string;
}) {
  return (
    <figure ref={observeRef} className={styles.globe} data-renderer="static">
      <div
        className={styles.stage}
        role="img"
        aria-label={ariaLabel}
      >
        <div className={styles.staticGlobe} aria-hidden="true" />
      </div>
    </figure>
  );
}

export function SupportedGlobeDynamic(props: SupportedGlobeProps = {}) {
  const targetRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return visible
    ? <DynamicSupportedGlobe {...props} />
    : <SupportedGlobeFallback ariaLabel={props.ariaLabel} observeRef={(node) => { targetRef.current = node; }} />;
}
