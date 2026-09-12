"use client";

import {
  useEffect,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type MouseEventHandler,
} from "react";
import { useAnimate, stagger, type AnimationSequence } from "motion/react";
import { Button } from "@home/ui";
import styles from "./home-mark.module.css";

type SharedHomeMarkProps = {
  className?: string;
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
const ease = [0.4, 0, 0.2, 1] as const;
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

/**
 * Base's observed three-layer sequence, adapted to natural h/o/m/e glyphs.
 * Raw extents are 2.3 / 1.901; Motion normalizes them to 1.6s / 1.2s.
 * Keep these authored timelines separate (exit is not reversed entry).
 * Asset/source details: public/home-mark/PROVENANCE.md.
 */
function MarkArtwork() {
  // Mini doesn't support the source's sequence + spring/transform API.
  const [scope, animate] = useAnimate<HTMLSpanElement>();

  useEffect(() => {
    const artwork = scope.current;
    const control = artwork.parentElement;
    if (!control) return;

    const squares = Array.from(artwork.querySelectorAll<HTMLElement>("[data-square]"));
    const ascender = artwork.querySelector<SVGSVGElement>("svg")!;
    const dots = Array.from(artwork.querySelectorAll<HTMLElement>("[data-doto]"));
    const chars = Array.from(artwork.querySelectorAll<HTMLElement>("[data-letter]"));
    const grids = Array.from(artwork.querySelectorAll<HTMLElement>("[data-grid]"));
    let phase: "idle" | "entering" | "expanded" | "exiting" = "idle";
    let queuedExit = false;
    let disposed = false;
    let offsets: number[] = [];

    function exit() {
      if (phase === "entering") {
        queuedExit = true;
        return;
      }
      if (phase !== "expanded") return;
      phase = "exiting";
      const sequence: AnimationSequence = [];

      [1, 3, 0, 2].forEach((index, rank) => {
        const at = 0.04 * rank;
        sequence.push(
          [dots[index], { opacity: [0, 1] }, { duration: 0.001, at }],
          [chars[index], { opacity: [1, 0] }, { duration: 0.001, at: at + 0.001 }],
        );
        Array.from(grids[index].children).forEach((pixel, k) => {
          sequence.push(
            [pixel, { opacity: 0 }, { duration: 0.001, at: at + 0.001 }],
            [pixel, { opacity: [0, 1] }, { duration: 0.02, at: at + 0.05 + 0.008 * k }],
            [pixel, { opacity: [1, 0, 1] }, { duration: 0.1, at: at + 0.55 + 0.01 * k }],
            [pixel, { opacity: [1, 0] }, { duration: 0.001, at: at + 0.5 }],
          );
        });
      });
      [2, 0, 3, 1].forEach((index, rank) => {
        sequence.push([squares[index], { opacity: [0, 1] }, { duration: 0.001, at: 0.36 + 0.03 * rank }]);
      });
      dots.forEach((dot) => {
        sequence.push([dot, { opacity: [1, 0] }, { duration: 0.001, at: 0.6 }]);
      });
      squares.slice(1).forEach((square, index) => {
        sequence.push([square, { x: [0, -offsets[index + 1]] }, { duration: 0.3, ease, at: 0.8 }]);
      });
      sequence.push(
        [ascender, { scaleY: [1, 0] }, { duration: 0.8, ease, at: 0.8 }],
        [artwork, { scale: 1 }, { type: "spring", bounce: 0.5, duration: 0.7, ease, at: 1.05 }],
        [squares.slice(1), { opacity: [1, 0] }, { duration: 0.0001, at: 1.8 }],
        [squares, { x: 0 }, { duration: 0.001, at: 1.9 }],
      );
      void animate(sequence, {
        duration: 1.2,
        reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      }).then(() => {
        if (!disposed) phase = "idle";
      });
    }

    function enter() {
      // Reference quirk: reentry does not clear a queued exit, and entry/exit
      // cannot be interrupted. A new leave/enter is needed after settling.
      if (phase !== "idle" || control?.matches(":disabled")) return;
      phase = "entering";
      queuedExit = false;
      const left = squares[0].getBoundingClientRect().left;
      offsets = squares.map((square) => square.getBoundingClientRect().left - left);
      const sequence: AnimationSequence = [
        [squares.slice(1), { opacity: 1 }, { duration: 0.001, at: 0 }],
        [artwork, { scale: 0.6 }, { duration: 0.4, ease, at: 0 }],
      ];
      squares.forEach((square, index) => {
        sequence.push([square, { x: [-offsets[index], 0] }, { type: "spring", duration: 0.5, ease, at: 0.05 * index }]);
      });
      sequence.push([ascender, { scaleY: [0, 1] }, { type: "spring", duration: 0.8, ease, at: 0.11 }]);
      dots.forEach((dot, index) => {
        sequence.push([dot, { opacity: [0, 1] }, { duration: 0.03, at: 0.5 + 0.05 * index }]);
      });
      grids.forEach((grid, index) => {
        const pixels = Array.from(grid.children);
        sequence.push(
          [pixels, { opacity: [0, 1] }, { duration: 0.001, delay: stagger(0.001, { startDelay: 0.05 * index }), at: 0 }],
          [pixels, { opacity: [1, 0] }, { duration: 0.005, delay: stagger(0.008, { startDelay: 1 + 0.05 * index }), at: 0 }],
        );
      });
      squares.forEach((square, index) => {
        sequence.push([square, { opacity: [1, 0] }, { duration: 0.001, at: 0.9 + 0.05 * index }]);
      });
      [2, 0, 3, 1].forEach((index, rank) => {
        const at = 1.2 + 0.04 * rank;
        sequence.push(
          [dots[index], { opacity: [1, 0] }, { duration: 0.0001, at }],
          [chars[index], { opacity: 1 }, { duration: 0.0001, at }],
        );
      });
      sequence.push([chars, { opacity: 1 }, { duration: 0.5, at: 1.8 }]);
      // Explicitly pass the user preference: the reference sets this through
      // MotionConfig, whereas Home does not need a global Motion provider.
      // Motion snaps transforms while preserving the timed opacity sequence.
      void animate(sequence, {
        duration: 1.6,
        reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      }).then(() => {
        if (disposed) return;
        phase = "expanded";
        if (queuedExit) exit();
      });
    }

    control.addEventListener("mouseenter", enter);
    control.addEventListener("mouseleave", exit);
    return () => {
      disposed = true;
      control.removeEventListener("mouseenter", enter);
      control.removeEventListener("mouseleave", exit);
      scope.animations.forEach((animation) => animation.stop());
      scope.animations.length = 0;
    };
  }, [animate, scope]);

  return (
    <span ref={scope} className={styles.artwork} aria-hidden="true">
      <span className={styles.square} data-square="">
        {/* Observed block/ascender fragment reused for h, not an h outline. */}
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
}

/** Fixed layout footprint; native link/button behavior belongs to the caller. */
export function HomeMark(props: HomeMarkProps) {
  // Remounting only the decorative desktop layer resets Motion's cached
  // transforms and cancels its sequences on responsive switches.
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, serverDesktop);
  const { className, ...controlProps } = props;
  const controlClass = className ? `${styles.control} ${className}` : styles.control;
  const artwork = <>
    <span className={styles.mobileSquare} aria-hidden="true" />
    {desktop ? <MarkArtwork /> : null}
  </>;

  return (
    <span className={styles.root}>
      {"href" in controlProps && controlProps.href !== undefined ? (
        <a {...controlProps} className={controlClass} aria-label="Home">
          {artwork}
        </a>
      ) : (
        <Button
          {...controlProps}
          type={controlProps.type ?? "button"}
          variant="quiet"
          className={controlClass}
          aria-label="Home"
        >
          {artwork}
        </Button>
      )}
    </span>
  );
}
