import type { Scanner } from "@tailwindcss/oxide";

export type SourceFile = { path: string; source: string };
export type CandidateFile = { path: string; candidates: string[] };
/** @public Used by the Storybook foundations candidate source bridge. */
export type CandidatePayload = CandidateFile[] | { status: "unavailable"; reason: string };
/** @public Used by the Storybook foundations confirmed candidate snapshot. */
export type CandidateSnapshot = { status: "available"; files: CandidateFile[] } | { status: "unavailable"; files: [] };

export function scanLibraryCandidates(files: SourceFile[], scanner: Scanner): CandidateFile[] {
  return files.map(({ path, source }) => ({
    path,
    candidates: scanner.getCandidatesWithPositions({ content: source, extension: "tsx" }).map(({ candidate }) => candidate),
  }));
}
