import type { AuditEntry } from "./contract";

const SETTINGS_LABELS: Record<string, string> = {
  brand: "Brand",
  regions: "Regions",
  invest: "Invest",
  products: "Products and markets",
  funding: "Money in and out",
  fees: "Fees",
};
const MAX_CHANGES = 8;

function leaves(value: unknown, path: string, out: Map<string, unknown>) {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) leaves(child, path ? `${path}.${key}` : key, out);
  } else out.set(path, value);
  return out;
}

function shown(value: unknown): string {
  if (value === undefined || value === null || value === "") return "none";
  if (Array.isArray(value) && value.every((item) => typeof item !== "object" || item === null)) return value.length ? value.join(", ") : "none";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function changedLeaves(before: unknown, after: unknown): { path: string; from: unknown; to: unknown }[] {
  const previous = leaves(before, "", new Map());
  const next = leaves(after, "", new Map());
  const paths = [...new Set([...previous.keys(), ...next.keys()])];
  return paths
    .filter((path) => JSON.stringify(previous.get(path)) !== JSON.stringify(next.get(path)))
    .map((path) => ({ path, from: previous.get(path), to: next.get(path) }));
}

function primitiveList(value: unknown): unknown[] | null {
  return Array.isArray(value) && value.every((item) => typeof item !== "object" || item === null) ? value : null;
}

function describeChange(path: string, from: unknown, to: unknown): string {
  const label = path || "value";
  const previous = primitiveList(from ?? []);
  const next = primitiveList(to ?? []);
  if (previous && next && (Array.isArray(from) || Array.isArray(to))) {
    const added = next.filter((item) => !previous.includes(item));
    const removed = previous.filter((item) => !next.includes(item));
    const parts = [added.length ? `added ${shown(added)}` : "", removed.length ? `removed ${shown(removed)}` : ""].filter(Boolean);
    return `${label}: ${parts.length ? parts.join("; ") : "reordered"}`;
  }
  return `${label}: ${shown(from)} → ${shown(to)}`;
}

export function summarizeAuditEntry(entry: AuditEntry): { title: string; changes: string[] } {
  if (entry.action === "customer.read") return { title: "Viewed a customer", changes: [`${entry.target.id} · ${entry.purpose}`] };
  if (entry.action === "support.credential.delete") return { title: "Removed the support assistant key", changes: [] };
  const changed = changedLeaves(entry.before, entry.after);
  const lines = changed.slice(0, MAX_CHANGES).map(({ path, from, to }) => describeChange(path, from, to));
  if (changed.length > MAX_CHANGES) lines.push(changed.length - MAX_CHANGES === 1 ? "1 more change" : `${changed.length - MAX_CHANGES} more changes`);
  if (entry.action === "support.credential.update") return { title: "Updated the support assistant key", changes: lines };
  return { title: `Updated ${SETTINGS_LABELS[entry.target.id] ?? entry.target.id} settings`, changes: lines };
}
