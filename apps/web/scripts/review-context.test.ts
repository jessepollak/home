import { expect, test } from "bun:test";
import savings from "../stories/review/boards/savings.json";
import {
  buildReviewContext,
  changesReviewManifest,
  formatReviewContext,
  parseReviewUrl,
  resolveFrame,
  type ReviewManifest,
} from "./review-context";

const manifest: ReviewManifest = {
  id: "savings",
  title: "Savings review",
  summary: "Funding flow",
  refs: { issue: 938, pr: 982 },
  sections: [
    {
      id: "screen",
      title: "Screen",
      note: "Inspect the funded state",
      frames: [
        {
          id: "funded",
          story: "pilot-savings-experience--funded",
          before: "pilot-savings-experience--old",
          label: "Funded",
          viewport: "mobile",
          change: "changed",
          note: "Balance updated",
        },
        {
          id: "compact",
          story: "pilot-savings-experience--compact",
          label: "Compact",
          viewport: { width: 420, height: 320 },
          change: "new",
        },
        {
          id: "narrow",
          story: "pilot-savings-experience--narrow",
          label: "Narrow",
          viewport: "narrow",
          change: "unchanged",
        },
        {
          id: "desktop",
          story: "pilot-savings-experience--desktop",
          label: "Desktop",
          viewport: "desktop",
          change: "unchanged",
        },
      ],
    },
  ],
};

const url =
  "https://preview.example/iframe.html?id=review-boards--savings&viewMode=story" +
  "&frame=funded&side=before&rev=abc1234&deployment=review.example";

test("parses a review URL and uses the reviewed deployment host", () => {
  expect(parseReviewUrl(url)).toEqual({
    board: "savings",
    frame: "funded",
    side: "before",
    variant: undefined,
    rev: "abc1234",
    origin: "https://review.example",
  });
  expect(
    parseReviewUrl("http://localhost:6006/iframe.html?id=review-boards--savings&frame=funded&side=after")
      .origin,
  ).toBe("http://localhost:6006");
});

test("rejects malformed links and unsafe board identifiers", () => {
  for (const input of [
    "not a url",
    "https://preview.example/?id=review-boards--savings&frame=funded&side=after",
    "https://preview.example/iframe.html?id=review-boards--../other&frame=funded&side=after",
    "https://preview.example/iframe.html?id=review-boards--savings&frame=funded&side=invalid",
    "https://preview.example/iframe.html?id=review-boards--savings" +
      "&frame=funded&side=after&deployment=evil.example/path",
  ])
    expect(() => parseReviewUrl(input)).toThrow("Malformed review URL");
});

test("resolves both sides, section notes and preset or custom viewport sizes", () => {
  expect(resolveFrame(manifest, "funded", "before")).toMatchObject({
    section: "Screen",
    story: "pilot-savings-experience--old",
    viewport: "390x844",
    change: "changed",
    sectionNote: "Inspect the funded state",
    note: "Balance updated",
  });
  expect(resolveFrame(manifest, "compact", "after").viewport).toBe("420x320");
  expect(resolveFrame(manifest, "narrow", "after").viewport).toBe("320x700");
  expect(resolveFrame(manifest, "desktop", "after").viewport).toBe("1440x900");
});

test("unknown frame fails clearly and a frame without a before story shows its proposal", () => {
  expect(() => resolveFrame(manifest, "missing", "after")).toThrow('Unknown frame "missing"');
  expect(resolveFrame(manifest, "compact", "before").story).toBe(resolveFrame(manifest, "compact", "after").story);
});

test("builds same-deployment links and an outdated context when a source changed", () => {
  const context = buildReviewContext(
    parseReviewUrl(url),
    manifest,
    "apps/web/stories/pilot-savings.stories.tsx",
    "def5678",
    "no",
    "yes",
  );
  expect(context.revision).toEqual({
    reviewed: "abc1234",
    head: "def5678",
    manifestChanged: "no",
    sourceChanged: "yes",
    outdated: "yes",
  });
  expect(context.urls).toEqual({
    canvas: "https://review.example/iframe.html?id=pilot-savings-experience--old&viewMode=story",
    manager: "https://review.example/?path=/story/pilot-savings-experience--old",
    board:
      "https://review.example/iframe.html?id=review-boards--savings&viewMode=story" +
      "&frame=funded&side=before&rev=abc1234&deployment=review.example",
  });
  expect(formatReviewContext(context)).toContain("outdated: yes");
  expect(formatReviewContext(context)).toContain("Section note: Inspect the funded state");
});

test("reports unknown freshness without a revision or source index", () => {
  const parsed = parseReviewUrl(
    "https://review.example/iframe.html?id=review-boards--savings&frame=compact&side=after",
  );
  const context = buildReviewContext(parsed, manifest, null, "def5678", "unknown", "unknown");
  expect(context.revision.outdated).toBe("unknown");
  expect(context.source).toBe("build Storybook to resolve the source file");
  expect(context.urls.board).toContain("frame=compact&side=after&deployment=review.example");
});

test("real savings board URLs default to after without side and resolve the manifest without refs", () => {
  const savingsUrl = parseReviewUrl(
    "http://localhost:6963/iframe.html?id=review-boards--savings&frame=funded",
  );
  expect(savingsUrl.side).toBe("after");
  const context = buildReviewContext(savingsUrl, savings as ReviewManifest, null, "head", "no", "no");
  expect(formatReviewContext(context)).toContain("Board: Savings — current system (savings)");
  expect(context.frame.story).toBe("pilot-savings-experience--funded");
});

test("automatic changes board resolves indexed frame name and viewport without a manifest", () => {
  const parsed = parseReviewUrl(
    "https://review.example/iframe.html?id=review-boards--changes&frame=pilot-savings-experience--funded&side=after",
  );
  const entries = {
    "pilot-savings-experience--funded": {
      id: parsed.frame, title: "Savings", name: "Funded desktop", type: "story",
      importPath: "./client/savings.stories.tsx",
    },
  };
  const context = buildReviewContext(parsed, changesReviewManifest(parsed, entries), null, "head", "no", "unknown");
  expect(context.board.id).toBe("changes");
  expect(context.frame.story).toBe("pilot-savings-experience--funded");
  expect(context.frame.label).toBe("Funded desktop");
  expect(context.frame.viewport).toBe("1440x900");
  expect(context.urls.canvas).toContain("id=pilot-savings-experience--funded");
  expect(resolveFrame(changesReviewManifest(parsed, {
    [parsed.frame]: { ...entries["pilot-savings-experience--funded"], name: "Funded narrow" },
  }), parsed.frame, "after").viewport).toBe("320x700");
});

test("automatic changes board rejects unknown frames and non-story index entries", () => {
  const parsed = parseReviewUrl(
    "https://review.example/iframe.html?id=review-boards--changes&frame=missing--frame&side=after",
  );
  expect(() => changesReviewManifest(parsed, {})).toThrow('Unknown story frame "missing--frame" in the story index');
  expect(() => changesReviewManifest(parsed, {
    [parsed.frame]: { id: parsed.frame, title: "Docs", name: "Docs", type: "docs", importPath: "./docs.mdx" },
  })).toThrow('Unknown story frame "missing--frame" in the story index');
  expect(() => changesReviewManifest(parsed, {
    [parsed.frame]: { id: "different--story", title: "Other", name: "Other", type: "story", importPath: "./other.stories.tsx" },
  })).toThrow('Unknown story frame "missing--frame" in the story index');
});

test("side by side reports both stories and uses after for the primary canvas", () => {
  const parsed = parseReviewUrl(url.replace("side=before", "side=both"));
  const context = buildReviewContext(parsed, manifest, null, "head", "no", "no");
  expect(context.frame.story).toBe("pilot-savings-experience--funded");
  expect(context.frame.stories).toEqual({
    after: "pilot-savings-experience--funded",
    before: "pilot-savings-experience--old",
  });
  expect(formatReviewContext(context)).toContain(
    "Stories: after pilot-savings-experience--funded  before pilot-savings-experience--old",
  );
  expect(context.urls.board).toContain("side=both");
});

test("side by side before variants resolve and preserve their selected story", () => {
  const parsed = parseReviewUrl(url.replace("side=before", "side=both&variant=before"));
  expect(parsed.variant).toBe("before");
  const context = buildReviewContext(parsed, manifest, null, "head", "no", "no");
  expect(context.frame).toMatchObject({ side: "both", variant: "before",
    story: "pilot-savings-experience--old" });
  expect(context.urls.canvas).toContain("id=pilot-savings-experience--old");
  expect(context.urls.board).toContain("side=both&variant=before");
  expect(formatReviewContext(context)).toContain("funded, both, before variant");
  expect(resolveFrame(manifest, "compact", "both", "before").story)
    .toBe("pilot-savings-experience--compact");
});

test("rejects a mismatched board manifest", () => {
  expect(() =>
    buildReviewContext(
      parseReviewUrl(url),
      { ...manifest, id: "other" },
      null,
      "def5678",
      "unknown",
      "unknown",
    ),
  ).toThrow('Unknown board "savings"');
});
