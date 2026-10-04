/// <reference types="vite/client" />
import globalsCss from "../../../../../app/globals.css?raw";
import type { CandidatePayload, CandidateSnapshot } from "./candidates";

export async function loadCandidateSet(load: () => Promise<{ default: CandidatePayload }> = () => import("virtual:library-candidates")): Promise<CandidateSnapshot> {
  try {
    const payload = (await load()).default;
    return Array.isArray(payload) ? { status: "available", files: payload } : { status: "unavailable", files: [] };
  } catch {
    return { status: "unavailable", files: [] };
  }
}

export const componentCandidateSet = await loadCandidateSet();
export const globalsSource = globalsCss;
