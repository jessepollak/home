import { animate, stagger, type AnimationPlaybackControls, type AnimationSequence } from "motion";

const ease = [0.4, 0, 0.2, 1] as const;

export function attachHomeMarkAnimation(artwork: HTMLElement, control: HTMLElement) {
  const squares = Array.from(artwork.querySelectorAll<HTMLElement>("[data-square]"));
  const ascender = artwork.querySelector<SVGSVGElement>("svg")!;
  const dots = Array.from(artwork.querySelectorAll<HTMLElement>("[data-doto]"));
  const chars = Array.from(artwork.querySelectorAll<HTMLElement>("[data-letter]"));
  const grids = Array.from(artwork.querySelectorAll<HTMLElement>("[data-grid]"));
  const running = new Set<AnimationPlaybackControls>();
  let phase: "idle" | "entering" | "expanded" | "exiting" = "idle";
  let queuedExit = false;
  let disposed = false;
  let offsets: number[] = [];

  function play(sequence: AnimationSequence, duration: number) {
    const controls = animate(sequence, {
      duration,
      reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    running.add(controls);
    return controls.then(() => {
      running.delete(controls);
    });
  }

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
    void play(sequence, 1.2).then(() => {
      if (!disposed) phase = "idle";
    });
  }

  function enter() {
    if (phase !== "idle" || control.matches(":disabled")) return;
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
    void play(sequence, 1.6).then(() => {
      if (disposed) return;
      phase = "expanded";
      if (queuedExit) exit();
    });
  }

  control.addEventListener("mouseenter", enter);
  control.addEventListener("mouseleave", exit);
  if (control.matches(":hover")) enter();
  return () => {
    disposed = true;
    control.removeEventListener("mouseenter", enter);
    control.removeEventListener("mouseleave", exit);
    running.forEach((controls) => controls.stop());
    running.clear();
  };
}
