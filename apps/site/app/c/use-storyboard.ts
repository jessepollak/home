"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const PLAY_RATIO = 0.6;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

type Run = { generation: number; step: number };
type Scene = { active: boolean; take: number; frame: "phone" | "admin" };

export const SceneContext = createContext<Scene | null>(null);

export function useStoryboard(holds: readonly number[]) {
  const last = holds.length;
  const scene = useContext(SceneContext);
  const staged = scene !== null;
  const cue = scene?.active ? scene.take : null;
  const [element, attach] = useState<HTMLDivElement | null>(null);
  const [motion, setMotion] = useState(false);
  const [visible, setVisible] = useState(false);
  const [run, setRun] = useState<Run>({ generation: 0, step: last });
  const [lastCue, setLastCue] = useState<number | null>(null);

  if (cue !== lastCue) {
    setLastCue(cue);
    if (cue !== null && motion) setRun((current) => ({ generation: current.generation + 1, step: 0 }));
  }

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION);
    const sync = () => {
      const allowed = !query.matches;
      setMotion(allowed);
      setRun((current) => ({ generation: current.generation + 1, step: allowed && !staged ? 0 : last }));
      if (staged) setLastCue(null);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [last, staged]);

  useEffect(() => {
    if (staged || !element || !motion) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      if (entry.intersectionRatio >= PLAY_RATIO) setVisible(true);
      else if (!entry.isIntersecting) setVisible(false);
    }, { threshold: [0, PLAY_RATIO] });
    observer.observe(element);
    return () => {
      observer.disconnect();
      setVisible(false);
    };
  }, [element, motion, staged]);

  const playing = motion && (staged ? cue !== null : visible) && run.step < last;
  const { generation, step } = run;

  useEffect(() => {
    const hold = holds[step];
    if (!playing || hold === undefined) return;
    const timer = window.setTimeout(() => {
      setRun((current) => current.generation === generation ? { generation, step: Math.min(step + 1, last) } : current);
    }, hold);
    return () => window.clearTimeout(timer);
  }, [playing, generation, step, holds, last]);

  const replay = useCallback(() => {
    setRun((current) => ({ generation: current.generation + 1, step: 0 }));
  }, []);

  return { attach, run: generation, step, done: step === last, playing, motion, replay, staged };
}
