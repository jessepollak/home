export const AGENTATION_ENDPOINT = "http://localhost:4747";

export function shouldRenderAgentation(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development";
}
