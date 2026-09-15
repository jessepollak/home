// Pure gating for the development-only Agentation feedback overlay (issue #480).
// Kept free of React and Next imports so tests can assert the gate directly.
export const AGENTATION_ENDPOINT = "http://localhost:4747";

export function shouldRenderAgentation(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development";
}
