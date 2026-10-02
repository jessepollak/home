import assert from "node:assert/strict";
import test from "node:test";
import { readWebSources } from "../knip-source.mjs";
import { evaluateStoryOnlyUsage, formatStoryOnlyReport } from "../story-only-usage.mjs";

const file = (path, content) => ({ path, content });
const component = file("components/ui/button.tsx", `
import { cva } from "class-variance-authority";
const buttonVariants = cva("base", { variants: { variant: { default: "a", proposal: "b", live: "c", unknown: "d" } }, defaultVariants: { variant: "default" } });
export function Button({ variant }) { return <button className={buttonVariants({ variant })}/> }
export { buttonVariants };
export function StoryOnly() { return null }
`);

test("repository story-only usage is advisory and visible", (t) => {
  const files = readWebSources();
  assert.ok(files.length > 0, "real web sources must not be empty");
  const results = evaluateStoryOnlyUsage(files);
  t.diagnostic(`Story-only shared component usage: ${results.length} finding(s)`);
  for (const result of results) t.diagnostic(formatStoryOnlyReport([result]).split("\n")[1]);
});

test("literal story variants and story-only exports surface; production and defaults do not", () => {
  const results = evaluateStoryOnlyUsage([
    component,
    file("components/ui/button.stories.tsx", 'import { Button as B, StoryOnly, buttonVariants as variants } from "./button"; <B variant={true ? "proposal" : "default"}/>; variants({variant: "proposal"}); void StoryOnly'),
    file("client/view.tsx", 'import { Button } from "@/components/ui/button"; <Button variant={"live"}/>'),
  ]);
  assert.ok(results.some((item) => item.kind === "variant" && item.name === "variant=proposal"));
  assert.ok(!results.some((item) => item.kind === "variant" && ["variant=live", "variant=default"].includes(item.name)));
  assert.ok(results.some((item) => item.kind === "export" && item.name === "StoryOnly"));
  assert.ok(!results.some((item) => item.kind === "export" && item.name === "Button"));
});

test("component variant forwarder does not hide a story-only proposal", () => {
  const results = evaluateStoryOnlyUsage([
    component,
    file("components/ui/button.stories.tsx", 'import { Button } from "./button"; <Button variant="proposal"/>'),
    file("client/view.tsx", 'import { Button } from "@/components/ui/button"; <Button variant="live"/>'),
  ]);
  assert.ok(results.some((item) => item.kind === "variant" && item.name === "variant=proposal" && item.usedBy.includes("components/ui/button.stories.tsx")));
  assert.ok(!results.some((item) => item.kind === "variant" && item.name === "variant=live"));
});

test("transitive story-only component export and variant uses surface through a production helper", () => {
  const results = evaluateStoryOnlyUsage([
    component,
    file("client/helper.tsx", 'import { Button, StoryOnly } from "@/components/ui/button"; export const proposal = <Button variant="proposal"/>; export { StoryOnly };'),
    file("client/helper.stories.tsx", 'import { proposal, StoryOnly } from "./helper"; void proposal; void StoryOnly'),
  ]);
  assert.ok(results.some((item) => item.kind === "export" && item.name === "StoryOnly" && item.usedBy.includes("client/helper.tsx")));
  assert.ok(results.some((item) => item.kind === "variant" && item.name === "variant=proposal" && item.usedBy.includes("client/helper.tsx")));
});

test("non-literal production expression conservatively suppresses the whole group", () => {
  const story = file("components/ui/button.stories.tsx", 'import { Button } from "./button"; <Button variant="proposal"/>');
  const withoutProduction = evaluateStoryOnlyUsage([component, story]);
  assert.ok(withoutProduction.some((item) => item.kind === "variant" && item.name === "variant=proposal"));
  const results = evaluateStoryOnlyUsage([
    component,
    story,
    file("client/view.tsx", 'import { Button } from "@/components/ui/button"; <Button variant={selection}/>'),
  ]);
  assert.ok(!results.some((item) => item.kind === "variant" && item.name === "variant=proposal"));
});

test("relative/index exports and logical attribute expressions resolve", () => {
  const results = evaluateStoryOnlyUsage([
    file("components/ui/button/index.tsx", 'import { cva } from "class-variance-authority"; const variants = cva("base", {variants: { tone: { default: "a", proposal: "b" } }, defaultVariants: {tone: "default"}}); export function Button({tone}) {return <span/>}'),
    file("components/ui/button.stories.tsx", 'import { Button } from "./button"; <Button tone={ok && "proposal"}/>'),
  ]);
  assert.ok(results.some((item) => item.kind === "variant" && item.name === "tone=proposal"));
});

test("type-only imports register as uses but never as runtime JSX or variant calls", () => {
  const story = (declaration) => file("components/ui/button.stories.tsx", `${declaration}\nfunction variants() { return null }\nvoid variants({ variant: "proposal" })`);
  for (const declaration of [
    '/** @import { buttonVariants as variants } from "./button" */',
    'import type { buttonVariants as variants } from "./button"; void (0 as unknown as typeof variants)',
    'import { type buttonVariants as variants } from "./button"; void (0 as unknown as typeof variants)',
  ]) {
    const results = evaluateStoryOnlyUsage([component, story(declaration)]);
    assert.ok(!results.some((item) => item.kind === "variant" && item.name === "variant=proposal"), declaration);
    assert.ok(results.some((item) => item.kind === "export" && item.name === "buttonVariants" && item.usedBy.includes("components/ui/button.stories.tsx")), declaration);
  }
  const runtime = evaluateStoryOnlyUsage([component, story('import { buttonVariants as variants } from "./button"; void variants({ variant: "proposal" })')]);
  assert.ok(runtime.some((item) => item.kind === "variant" && item.name === "variant=proposal"));
});
