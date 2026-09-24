"use client";

import {
  memo,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type MouseEventHandler,
} from "react";
import { Button } from "@/components/ui/button";
import styles from "./home-mark.module.css";

type SharedHomeMarkProps = {
  className?: string;
  compact?: boolean;
};

type HomeMarkLinkProps = SharedHomeMarkProps &
  Omit<ComponentPropsWithoutRef<"a">, "children" | "className"> & {
    href: string;
  };

type HomeMarkButtonProps = SharedHomeMarkProps &
  Omit<
    ComponentPropsWithoutRef<"button">,
    "children" | "className" | "onClick"
  > & {
    href?: never;
    onClick: MouseEventHandler<HTMLButtonElement>;
  };

export type HomeMarkProps = HomeMarkLinkProps | HomeMarkButtonProps;

const desktopQuery = "(min-width: 768px)";
const letters = [..."home"];

function subscribeDesktop(callback: () => void) {
  const media = window.matchMedia(desktopQuery);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  }
  media.addListener?.(callback);
  return () => media.removeListener?.(callback);
}

function isDesktop() {
  return window.matchMedia(desktopQuery).matches;
}

function serverDesktop() {
  return true;
}

const MarkArtwork = memo(function MarkArtwork({ interactive = true }: { interactive?: boolean }) {
  const artworkRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const artwork = artworkRef.current;
    const control = artwork?.parentElement;
    if (!interactive || !artwork || !control) return;
    let detach: (() => void) | undefined;
    let disposed = false;
    const listen = () => control.addEventListener("pointerenter", load, { once: true });
    function load() {
      import("./home-mark-animation").then(({ attachHomeMarkAnimation }) => {
        if (!disposed && artwork && control) detach = attachHomeMarkAnimation(artwork, control);
      }, () => {
        if (!disposed) listen();
      });
    }
    listen();
    return () => {
      disposed = true;
      control.removeEventListener("pointerenter", load);
      detach?.();
    };
  }, [interactive]);

  return (
    <span ref={artworkRef} className={styles.artwork} aria-hidden="true">
      <span className={styles.square} data-square="">
        <svg
          className={styles.ascender}
          width="664"
          height="218"
          viewBox="0 0 664 218"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M0.786503 5.13191C0 6.74052 0 8.83171 0 13.0141V204.98C0 209.162 0 211.253 0.786503 212.862C1.53955 214.402 2.78253 215.648 4.31969 216.402C5.92514 217.19 8.01222 217.19 12.1864 217.19H142.072C146.246 217.19 148.333 217.19 149.938 216.402C151.475 215.648 152.718 214.402 153.471 212.862C154.258 211.253 154.258 209.162 154.258 204.98V74.8388C154.258 70.6564 154.258 68.5652 153.471 66.9566C152.718 65.4164 151.475 64.171 149.938 63.4164C148.333 62.6284 146.246 62.6284 142.072 62.6284H73.8896C69.7154 62.6284 67.6283 62.6284 66.0229 61.8403C64.4857 61.0858 63.2427 59.8404 62.4897 58.3002C61.7032 56.6916 61.7032 54.6004 61.7032 50.418V13.0141C61.7032 8.83171 61.7032 6.74052 60.9167 5.13191C60.1636 3.59172 58.9206 2.34629 57.3835 1.59176C55.778 0.803711 53.691 0.803711 49.5168 0.803711H12.1864C8.01222 0.803711 5.92514 0.803711 4.31969 1.59176C2.78253 2.34629 1.53955 3.59172 0.786503 5.13191Z"
            fill="currentColor"
          />
        </svg>
      </span>
      {[1, 2, 3].map((index) => <span key={index} className={styles.square} data-square="" />)}
      <span className={styles.dotoLayer}>
        {letters.map((letter) => (
          <span key={letter} className={styles.doto} data-doto="">
            {letter}
            <span className={styles.grid} data-grid="">
              {Array.from({ length: 25 }, (_, index) => <span key={index} />)}
            </span>
          </span>
        ))}
      </span>
      <span className={styles.letterLayer}>
        {letters.map((letter) => <span key={letter} data-letter="">{letter}</span>)}
      </span>
    </span>
  );
});

export function HomeMark(props: HomeMarkProps) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, serverDesktop);
  const { className, compact = false, "aria-label": ariaLabel, ...controlProps } = props;
  const controlClass = className ? `${styles.control} ${className}` : styles.control;
  const artwork = <>
    <span className={styles.mobileSquare} aria-hidden="true" />
    {desktop ? <MarkArtwork interactive={!compact} /> : null}
  </>;

  return (
    <span className={compact ? `${styles.root} ${styles.compact}` : styles.root} data-home-mark="">
      {"href" in controlProps && controlProps.href !== undefined ? (
        <a {...controlProps} className={controlClass} aria-label={ariaLabel ?? "Home"}>
          {artwork}
        </a>
      ) : (
        <Button
          {...controlProps}
          type={controlProps.type ?? "button"}
          variant="ghost"
          className={controlClass}
          aria-label={ariaLabel ?? "Home"}
        >
          {artwork}
        </Button>
      )}
    </span>
  );
}
