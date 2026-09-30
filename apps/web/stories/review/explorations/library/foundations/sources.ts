/// <reference types="vite/client" />
import globalsCss from "../../../../../app/globals.css?raw";
import type { CandidateFile, CandidateSnapshot } from "./candidates";

export async function loadCandidateSet(load: () => Promise<{ default: CandidateFile[] }> = () => import("virtual:library-candidates")): Promise<CandidateSnapshot> {
  try {
    return { status: "available", files: (await load()).default };
  } catch {
    return { status: "unavailable", files: [] };
  }
}

export const componentCandidateSet = await loadCandidateSet();
export const globalsSource = globalsCss;
