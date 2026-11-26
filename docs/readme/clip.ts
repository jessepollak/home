// Record the README sample-data clip on the sample-only boundary in sample.ts:
// Home → Cash → Add money → Invest → Bitcoin → the Send review sheet, never pressing Send.
import type { Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_URL, OUTPUT_DIR, RECIPIENT_NAME, assertCleanRun, hideDevelopmentBadge, openSampleContext } from "./sample";

const OUTPUT = join(OUTPUT_DIR, "demo.gif");
const MAX_BYTES = 4 * 1024 * 1024;
const WIDTH = 390;
const HEIGHT = 844;

async function hold(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

const videoDir = await mkdtemp(join(tmpdir(), "home-readme-clip-"));
const { browser, context } = await openSampleContext({
  recordVideo: { dir: videoDir, size: { width: WIDTH, height: HEIGHT } },
});
await context.addInitScript(() => sessionStorage.setItem("home:playwright-smoke:signed-in", "1"));

let summary = "";
let video = "";
let journeyStartMs = 0;
let chartLoad: [number, number] = [0, 0];
let journeyEndMs = 0;
try {
  const page = await context.newPage();
  const recordingStartMs = Date.now();
  await page.goto(`${BASE_URL}/home`);
  await page.getByText("$5,985.08", { exact: true }).first().waitFor();
  await page.getByRole("region", { name: "Activity" }).getByText("Received", { exact: true }).first().waitFor({ state: "visible" });
  await hideDevelopmentBadge(page);
  await hold(page, 1_000);
  journeyStartMs = Date.now() - recordingStartMs;
  await hold(page, 1_800);

  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash / }).click();
  await page.getByRole("region", { name: "Savings" }).getByRole("button", { name: /^US dollar/ }).waitFor();
  await hold(page, 1_600);

  await page.getByRole("button", { name: "Add money" }).first().click();
  await page.getByRole("dialog", { name: "Add money" }).getByRole("button", { name: /^Deposit USD/ }).waitFor();
  await hold(page, 1_800);
  await page.getByRole("button", { name: "Close add money" }).click();
  await page.getByRole("dialog", { name: "Add money" }).waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await page.getByText("$184.32", { exact: true }).waitFor();
  await hold(page, 1_600);

  const chartLoadStartMs = Date.now() - recordingStartMs;
  await page.getByRole("button", { name: /^Bitcoin/ }).first().click();
  await page.getByRole("heading", { name: "Bitcoin" }).first().waitFor();
  await page.locator('[data-layer-range="1W"][data-layer-state="shown"]').waitFor();
  await page.locator('[aria-roledescription="chart"]').waitFor();
  await hold(page, 400);
  chartLoad = [chartLoadStartMs - journeyStartMs, Date.now() - recordingStartMs - journeyStartMs];
  await hold(page, 2_200);

  await page.getByRole("button", { name: "Home", exact: true }).last().click();
  await page.getByText("$5,985.08", { exact: true }).first().waitFor();
  await hold(page, 700);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("dialog", { name: "Send" }).waitFor();
  await hold(page, 500);
  await page.getByRole("combobox", { name: "Asset" }).click();
  await hold(page, 500);
  await page.getByRole("option", { name: /US dollar|USDC/ }).first().click();
  await page.getByRole("textbox", { name: "Amount" }).pressSequentially("25", { delay: 180 });
  await hold(page, 400);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "To" }).waitFor();
  await hold(page, 700);
  await page.getByRole("button", { name: new RegExp(`^${RECIPIENT_NAME.replaceAll(".", "\\.")}`) }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send $25.00" }).waitFor();
  await hold(page, 2_500);
  journeyEndMs = Date.now() - recordingStartMs;

  summary = assertCleanRun({ expectBasenameResolver: false });
  await page.close();
  video = await page.video()!.path();
} finally {
  await context.close();
  await browser.close();
}

const encode = spawnSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-ss", (journeyStartMs / 1_000).toFixed(2),
  "-t", ((journeyEndMs - journeyStartMs) / 1_000).toFixed(2),
  "-i", video,
  "-vf", `fps=15,select='not(between(t,${(chartLoad[0] / 1_000).toFixed(2)},${(chartLoad[1] / 1_000).toFixed(2)}))',setpts=N/15/TB,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  "-loop", "0",
  OUTPUT,
], { stdio: "inherit" });
await rm(videoDir, { recursive: true, force: true });
if (encode.status !== 0) throw new Error("ffmpeg failed to encode the clip.");

const { size } = await stat(OUTPUT);
const seconds = (journeyEndMs - journeyStartMs - (chartLoad[1] - chartLoad[0])) / 1_000;
if (size > MAX_BYTES) throw new Error(`The clip is ${(size / 1024 / 1024).toFixed(1)} MB, above the 4 MB README budget.`);
console.log(
  `Recorded ${seconds.toFixed(1)} s README clip (${(size / 1024 / 1024).toFixed(1)} MB) ` +
  `from ${BASE_URL} into ${OUTPUT}; ${summary}`,
);
