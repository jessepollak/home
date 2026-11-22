"use client";

import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "@/components/money-ticker";

const PLAY_RATIO = 0.6;

export function useStoryboard(holds: readonly number[]) {
  const [element, attach] = useState<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const last = holds.length;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      if (entry.intersectionRatio >= PLAY_RATIO) setPlaying(true);
      else if (!entry.isIntersecting) setPlaying(false);
    }, { threshold: [0, PLAY_RATIO] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  useEffect(() => {
    const hold = holds[step];
    if (!playing || reducedMotion || hold === undefined) return;
    const timer = window.setTimeout(() => setStep((current) => Math.min(current + 1, last)), hold);
    return () => window.clearTimeout(timer);
  }, [playing, reducedMotion, holds, step, last]);

  const replay = useCallback(() => {
    setStep(0);
    setRun((current) => current + 1);
    setPlaying(true);
  }, []);

  return { attach, run, step: reducedMotion ? last : step, done: reducedMotion || step === last, reducedMotion, replay };
}
