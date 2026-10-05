export { readJson } from "@/shared/http/read-json";

export function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}
