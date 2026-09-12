// Cost/turn accounting for a lane: its own session plus every child session under its dir.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

function sessionFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sessionFiles(p, acc);
    else if (e.name.endsWith(".jsonl")) acc.push(p);
  }
  return acc;
}
/** Sum cost and count assistant turns across the lane's own session and every child session under it. */
export function laneUsage(laneDir) {
  let costUsd = 0, turns = 0, lastActivityAt = 0;
  for (const f of sessionFiles(laneDir)) {
    lastActivityAt = Math.max(lastActivityAt, statSync(f).mtimeMs);
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.includes('"usage"')) continue;
      try {
        const o = JSON.parse(line);
        const m = o.message;
        if (o.type === "message" && m?.role === "assistant") { turns++; costUsd += m.usage?.cost?.total ?? 0; }
      } catch { /* partial line */ }
    }
  }
  return { costUsd, turns, lastActivityAt };
}
