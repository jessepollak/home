"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import styles from "./supported-globe.module.css";

const DynamicSupportedGlobe = dynamic(
  () => import("./supported-globe").then((module) => module.SupportedGlobe),
  { ssr: false, loading: () => <SupportedGlobeFallback /> },
);

function SupportedGlobeFallback({ observeRef }: { observeRef?: (node: HTMLElement | null) => void }) {
  return (
    <figure ref={observeRef} className={styles.globe} data-renderer="static">
      <div
        className={styles.stage}
        role="img"
        aria-label="World with illustrative money connections"
      >
        <div className={styles.staticGlobe} aria-hidden="true" />
      </div>
    </figure>
  );
}

export function SupportedGlobeDynamic() {
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
    ? <DynamicSupportedGlobe />
    : <SupportedGlobeFallback observeRef={(node) => { targetRef.current = node; }} />;
}
