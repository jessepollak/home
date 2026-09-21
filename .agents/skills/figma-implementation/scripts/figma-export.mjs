#!/usr/bin/env node
// Reference export via the Figma REST images endpoint — the canonical pixel-diff
// reference. It is a separate API surface from the mux-gateway MCP tools used in
// Pass 1 (Map), it returns an exact integer scale, and it does not consume the
// MCP server's per-day tool-call budget.
//
// Usage (from the worktree root):
//   FIGMA_ACCESS_TOKEN=... node .agents/skills/figma-implementation/scripts/figma-export.mjs \
//     --file <fileKey> --node 5:165 [--scale 1] [--out /tmp/figma-verify/<task>/ref.png] \
//     [--spec docs/design/<task>/audit.spec.json] [--dims] [--tree <path>] [--depth 4]
//
//   --spec  take fileKey/nodeId (and default output path) from the audited spec
//   --dims  print the node's absolute bounding box (use it as the capture viewport)
//   --tree  write the REST node subtree JSON for offline Map/Audit work when the
//           mux-gateway MCP tools are unreachable from this agent
//
// The token is read from FIGMA_ACCESS_TOKEN and is never printed, echoed into a
// report, or written to disk. Exports are read-only: this script cannot modify
// the Figma file.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { numberArg, parseArgs, stringArg } from "./lib/cli.mjs";
import { parseAuditSpec } from "./lib/spec.mjs";

const args = parseArgs(process.argv.slice(2), { repeatable: [] });

const token = process.env.FIGMA_ACCESS_TOKEN;
if (!token) {
  console.error(
    "Set FIGMA_ACCESS_TOKEN (a Figma token with file_content:read). It is read from the environment only — " +
      "never pass it as an argument.",
  );
  process.exit(2);
}

let spec = null;
if (stringArg(args, "spec")) {
  spec = parseAuditSpec(readFileSync(stringArg(args, "spec"), "utf8"));
}

const fileKey = stringArg(args, "file") ?? spec?.frame?.fileKey;
const nodeId = (stringArg(args, "node") ?? spec?.frame?.nodeId)?.replaceAll("-", ":");
if (!fileKey || !nodeId) {
  console.error("Required: --file <fileKey> --node <nodeId (5:165 or 5-165)>, or a --spec with frame.fileKey/frame.nodeId");
  process.exit(2);
}

const scale = numberArg(args, "scale") ?? 1;
if (scale !== 1) {
  console.error(`--scale must be 1 for a CSS-pixel reference, got: ${scale}`);
  process.exit(2);
}
const out = stringArg(args, "out") ?? join("/tmp/figma-verify", nodeId.replaceAll(":", "-"), `ref@${scale}x.png`);

async function figmaApi(path) {
  const response = await fetch(`https://api.figma.com${path}`, {
    headers: { "X-Figma-Token": token },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Figma API ${response.status} on ${path}: ${body.slice(0, 300)}` +
        (response.status === 403 ? " (check the token scope: file_content:read)" : "") +
        (response.status === 404 ? " (check the fileKey and nodeId)" : ""),
    );
  }
  return response.json();
}

if (args.dims || args.tree) {
  const depth = numberArg(args, "depth") ?? 4;
  const geometry = args.tree ? "&geometry=paths" : "";
  const nodes = await figmaApi(
    `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=${depth}${geometry}`,
  );
  const node = nodes.nodes?.[nodeId]?.document;
  if (args.dims) {
    const box = node?.absoluteBoundingBox;
    console.log(
      box
        ? `DIMS ${Math.round(box.width)}x${Math.round(box.height)} NAME ${JSON.stringify(node.name)}`
        : "DIMS unknown (no absoluteBoundingBox on this node)",
    );
  }
  if (typeof args.tree === "string") {
    mkdirSync(dirname(args.tree), { recursive: true });
    writeFileSync(args.tree, `${JSON.stringify(nodes, null, 2)}\n`);
    console.log("TREE", args.tree);
  }
}

const images = await figmaApi(
  `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${scale}`,
);
const imageUrl = images.images?.[nodeId];
if (!imageUrl) {
  throw new Error(`No image URL returned for ${nodeId} (err: ${images.err ?? "none"}).`);
}
const image = await fetch(imageUrl);
if (!image.ok) throw new Error(`Image download failed: ${image.status}`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(await image.arrayBuffer()));
console.log("REF", out);
