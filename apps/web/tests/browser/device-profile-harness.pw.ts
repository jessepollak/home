import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Result } from "../../scripts/device-profile/model";
import { validResult } from "../../scripts/device-profile/model";

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 390, height: 844 } });

const bundle = execFileSync("bun", ["build", resolve(__dirname, "../../scripts/device-profile/harness.ts"), "--target=browser", "--minify"], { encoding: "utf8" });

const fixture = `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body { margin: 0 } ul { margin: 0; padding: 0; list-style: none } li { height: 40px }</style>
</head>
<body>
  <main data-app-main-authenticated class="relative min-w-0 flex-1 bg-muted">
    <section aria-label="Activity" data-activity-sources="transfers:ready actions:ready orders:ready"><ul id="feed"></ul></section>
    <p id="end" role="status" hidden>End of activity</p>
  </main>
  <script>
    const feed = document.getElementById("feed"), end = document.getElementById("end");
    let loaded = 0;
    function appendPage() {
      const limit = Math.min(loaded + 25, 300);
      while (loaded < limit) {
        const row = document.createElement("li");
        row.setAttribute("aria-posinset", String(++loaded));
        row.setAttribute("aria-setsize", "300");
        row.textContent = "Row " + loaded;
        feed.append(row);
      }
      if (loaded === 300) end.hidden = false;
    }
    appendPage();
    window.addEventListener("scroll", () => {
      while (end.hidden && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 5) appendPage();
    });
  </script>
</body>
</html>`;

for (const workload of ["home-fling", "activity-fling"] as const) {
  test(`${workload} loads and measures 300 rows through the document scroll host`, async ({ page }) => {
    const plan = { workload, rows: 300, label: "browser-regression", repeat: 1, duration: 10 };
    await page.addInitScript({ content: `sessionStorage.setItem("home:device-profile:plan",${JSON.stringify(JSON.stringify(plan))});\n${bundle}` });
    let capture: (result: Result) => void = () => {};
    const captured = new Promise<Result>((done) => { capture = done; });
    await page.route("**/__device-profile/results", async (route) => {
      const payload: unknown = route.request().postDataJSON();
      if (!validResult(payload)) throw new Error("The device-profile harness posted an invalid result");
      capture(payload);
      await route.fulfill({ json: { filename: "browser-regression.json" } });
    });
    await page.route("**/device-profile-harness-fixture", (route) => route.fulfill({ contentType: "text/html", body: fixture }));
    await page.goto("/device-profile-harness-fixture");

    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 15_000, message: "the device-profile harness did not scroll the document host" }).toBeGreaterThan(0);

    const result = await captured;
    const [run] = result.runs;
    if (!run) throw new Error("The device-profile harness posted no runs");
    expect(result.error).toBeUndefined();
    expect(result.runs).toHaveLength(1);
    expect(run.rowsLoaded).toBe(300);
    expect(run.frameCount).toBeGreaterThan(0);
    expect(run.partialSource).toBeUndefined();
  });
}
