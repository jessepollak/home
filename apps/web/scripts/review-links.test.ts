import { expect, test } from "bun:test";
import { rewriteReviewLinks } from "./review-links";

const oldHost = "home-storybook-old.vercel.app";
const host = "home-storybook-new.vercel.app";
const revision = "a".repeat(40);
const options = { host, revision };
const url = (board: string, frame: string, extra = "") =>
  `https://${oldHost}/iframe.html?id=review-boards--${board}&viewMode=story&frame=${frame}${extra}&rev=${"b".repeat(40)}&deployment=${oldHost}`;
const preview = (rows: string, prelude = "") => `## Review\n\nSummary\n\n## Preview\n\n<!-- User-visible work: Put \`story:<story-id>\` in each row's Board cell. -->\n\n${prelude}| State + viewport | Board | Evidence |\n| --- | --- | --- |\n${rows}\n<details><summary>Evidence</summary>\n\n## Verification\n\nCloses #12\n`;
const link = (text: string, input: string) => `[${text}](${input})`;
const getLinks = (body: string, text: string) => [...body.matchAll(new RegExp(`\\[${text}\\]\\((https?://[^)]+)\\)`, "g"))]
  .map((match) => new URL(match[1]));

test("replaces ordered unique story tokens and existing changes links, refreshing host and revision", () => {
  const body = preview(
    `| One | \`story:flow--second\` | image |\n` +
    `| Two | ${link("Board", url("changes", "flow--first"))} | image |\n` +
    `| Three | \`story:flow--second\` and \`story:flow--third\` | image |\n`,
  );
  const result = rewriteReviewLinks(body, options);
  const links = getLinks(result, "Board");
  expect(links.map((entry) => entry.searchParams.get("frame"))).toEqual(["flow--second", "flow--first", "flow--second", "flow--third"]);
  for (const entry of [...links, ...getLinks(result, "Review board")]) {
    expect(entry.host).toBe(host);
    expect(entry.searchParams.get("focus")).toBe("flow--second,flow--first,flow--third");
    expect(entry.searchParams.get("rev")).toBe(revision);
    expect(entry.searchParams.get("deployment")).toBe(host);
  }
  expect(result).toContain(`focus=flow--second,flow--first,flow--third&frame=flow--second&rev=${revision}&deployment=${host}`);
  expect(getLinks(result, "Review board")[0].searchParams.get("frame")).toBe("flow--second");
  expect(rewriteReviewLinks(result, options)).toBe(result);
});

test("fills the exact template Preview fixture and ignores its placeholder", () => {
  const body = `## Preview\n\n<!-- User-visible work: ... Put \`story:<story-id>\` in each row's Board cell ... -->\n\n<!-- review-links:start -->\n<!-- review-links:end -->\n\n| State + viewport | Board | Evidence |\n| --- | --- | --- |\n| Changed state — 390×844 CSS px | \`story:<story-id>\` | GitHub attachment |\n\n<details><summary>Evidence</summary>\n`;
  const result = rewriteReviewLinks(body, options);
  expect(result).toContain(`## Preview\n<!-- review-links:start -->\n[Review board](https://${host}/iframe.html?id=review-boards--changes&viewMode=story&rev=${revision}&deployment=${host})\n<!-- review-links:end -->`);
  expect(result).toContain("| Changed state — 390×844 CSS px | `story:<story-id>` | GitHub attachment |");
  expect(result.match(/<!-- review-links:start -->/g)).toHaveLength(1);
  expect(rewriteReviewLinks(result, options)).toBe(result);
});

test("replaces a legacy standalone Review board line", () => {
  const body = preview(`| State | \`story:flow--first\` | image |\n`, `${link("Review board", url("changes", "stale--frame"))}\n\n`);
  const result = rewriteReviewLinks(body, options);
  expect(result.match(/\[Review board\]/g)).toHaveLength(1);
  expect(getLinks(result, "Review board")[0].searchParams.get("frame")).toBe("flow--first");
  expect(rewriteReviewLinks(result, options)).toBe(result);
});

test("retains a curated top board and row id/frame/side/variant while refreshing deployment", () => {
  const curated = url("savings", "funded", "&side=both&variant=before");
  const body = preview(`| Before | ${link("Board", curated)} | image |\n| New | \`story:flow--first\` | image |\n`,
    `<!-- review-links:start -->\n${link("Review board", curated)}\n<!-- review-links:end -->\n\n`);
  const result = rewriteReviewLinks(body, options);
  for (const entry of [getLinks(result, "Review board")[0], getLinks(result, "Board")[0]]) {
    expect(entry.host).toBe(host);
    expect(entry.searchParams.get("id")).toBe("review-boards--savings");
    expect(entry.searchParams.get("frame")).toBe("funded");
    expect(entry.searchParams.get("side")).toBe("both");
    expect(entry.searchParams.get("variant")).toBe("before");
    expect(entry.searchParams.get("rev")).toBe(revision);
    expect(entry.searchParams.get("deployment")).toBe(host);
  }
  expect(getLinks(result, "Board")[1].searchParams.get("focus")).toBe("flow--first");
  expect(rewriteReviewLinks(result, options)).toBe(result);
});

test("keeps N/A previews untouched after comment lines and does not edit outside Preview", () => {
  const none = `## Preview\n\n<!-- User-visible work: ... -->\n\nN/A: docs-only / CI-only\n\n<details><summary>Evidence</summary>\n`;
  expect(rewriteReviewLinks(none, options)).toBe(none);
  expect(rewriteReviewLinks("## Review\nNo Preview\n", options)).toBe("## Review\nNo Preview\n");
  const outer = link("Board", url("changes", "outside--story"));
  const body = `${outer}\n${preview("| State | `story:flow--first` | image |\n")}\n${outer}`;
  const result = rewriteReviewLinks(body, options);
  expect(result.startsWith(`${outer}\n`)).toBe(true);
  expect(result.endsWith(`\n${outer}`)).toBe(true);
});

test("preserves CRLF and moves a managed block from later in Preview", () => {
  const body = preview(`| State | \`story:flow--first\` | image |\n<!-- review-links:start -->\n<!-- review-links:end -->\n`).replaceAll("\n", "\r\n");
  const result = rewriteReviewLinks(body, options);
  expect(result).not.toMatch(/(?<!\r)\n/);
  expect(result).toContain("## Preview\r\n<!-- review-links:start -->");
  expect(result.match(/<!-- review-links:start -->/g)).toHaveLength(1);
  expect(rewriteReviewLinks(result, options)).toBe(result);
});
