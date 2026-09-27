import { expect, test } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";

for (const path of ["/home", "/activity"]) {
  test(`${path} has no descendant :has() on the Recent list ancestor chain`, async ({ page }) => {
    await seedSignedInSession(page);
    await installApiFixtures(page);
    const wallet = sessionBody.smartAccount.address;
    const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const recipient = "0x2222222222222222222222222222222222222222";
    await page.route("**/api/activity*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/activity") return route.fallback();
      const to = url.searchParams.get("to")!;
      return json(route, {
        version: 1,
        walletAddress: wallet,
        chainId: 8453,
        currency: url.searchParams.get("currency") ?? "USD",
        window: { from: new Date(Date.parse(to) - 24 * 60 * 60_000).toISOString(), to },
        transfers: Array.from({ length: 24 }, (_, index) => ({
          id: `8453:${token}:feed-${index}`,
          logId: `feed-${index}`,
          chainId: 8453,
          assetId: "usdc",
          tokenAddress: token,
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          tokenImageUrl: null,
          walletAddress: wallet,
          fromAddress: index % 2 ? wallet : recipient,
          toAddress: index % 2 ? recipient : wallet,
          direction: index % 2 ? "outgoing" : "incoming",
          amountBaseUnits: "1000000",
          blockNumber: String(100 - index),
          blockHash: `0x${"ef".repeat(32)}`,
          transactionHash: `0x${index.toString(16).padStart(64, "0")}`,
          logIndex: "1",
          blockTimestamp: new Date(Date.parse(to) - (index + 1) * 60_000).toISOString(),
          valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
        })),
        nextCursor: null,
        source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
      });
    });
    await page.goto(path);
    const list = page.locator('main[data-app-main-authenticated] ul:has(> li[data-index])');
    await expect(list.locator('li[data-index]')).not.toHaveCount(0);
    await expect(list.locator('li[data-index]').first()).toHaveAttribute("aria-setsize", "24");

    const offenders = await list.evaluate((ul) => {
      const ancestors: Element[] = [];
      for (let node: Element | null = ul; node; node = node.parentElement) ancestors.push(node);
      const found: string[] = [];
      const describe = (element: Element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.getAttribute("data-slot") ? `[data-slot="${element.getAttribute("data-slot")}"]` : ""}`;
      const closingParen = (text: string, open: number) => {
        let depth = 1;
        let bracket = 0;
        let quote = "";
        for (let i = open + 1; i < text.length; i++) {
          const char = text[i]!;
          if (char === "\\") { i++; continue; }
          if (quote) { if (char === quote) quote = ""; continue; }
          if (char === "\"" || char === "'") { quote = char; continue; }
          if (char === "[") bracket++;
          else if (char === "]") bracket--;
          else if (!bracket && char === "(") depth++;
          else if (!bracket && char === ")" && --depth === 0) return i;
        }
        throw new Error(`Unclosed selector: ${text}`);
      };
      const splitBranches = (argument: string) => {
        const branches: string[] = [];
        let start = 0;
        let depth = 0;
        let bracket = 0;
        let quote = "";
        for (let i = 0; i < argument.length; i++) {
          const char = argument[i]!;
          if (char === "\\") { i++; continue; }
          if (quote) { if (char === quote) quote = ""; continue; }
          if (char === "\"" || char === "'") { quote = char; continue; }
          if (char === "[") bracket++;
          else if (char === "]") bracket--;
          else if (!bracket && char === "(") depth++;
          else if (!bracket && char === ")") depth--;
          else if (!bracket && !depth && char === ",") {
            branches.push(argument.slice(start, i));
            start = i + 1;
          }
        }
        branches.push(argument.slice(start));
        return branches;
      };
      const inspectSelector = (selector: string) => {
        for (let i = 0; i < selector.length; i++) {
          if (selector[i] !== ":" || selector.slice(i, i + 5) !== ":has(") continue;
          const end = closingParen(selector, i + 4);
          const argument = selector.slice(i + 5, end);
          if (splitBranches(argument).some((branch) => !/^[>+~]/.test(branch.trimStart()))) {
            let start = i;
            let subjectEnd = i;
            let depth = 0;
            let bracket = 0;
            for (let j = i - 1; j >= 0; j--) {
              const char = selector[j]!;
              if (char === ")") depth++;
              else if (char === "(") {
                if (depth) depth--;
                else if (selector.slice(j - 4, j) === ":not") {
                  subjectEnd = j - 4;
                  start = subjectEnd;
                  j = subjectEnd + 1;
                  continue;
                } else {
                  start = j + 1;
                  break;
                }
              } else if (char === "]") bracket++;
              else if (char === "[") bracket--;
              if (!depth && !bracket && (char === "," || char === ">" || char === "+" || char === "~" || /\s/.test(char))) {
                start = j + 1;
                break;
              }
              start = j;
            }
            let compound = selector.slice(start, subjectEnd).trim();
            const branch = compound.match(/:(?:where|is)\(([^()]*)$/);
            if (branch) compound = compound.slice(0, branch.index) + branch[1]!.split(",").at(-1)!.trim();
            compound = compound.replace(/:not\([^()]*$/, "").replace(/:has\([^()]*\)/g, "");
            if (!compound) compound = "*";
            for (const element of ancestors) {
              try {
                if (element.matches(compound)) found.push(`${selector} -> ${describe(element)} (compound ${compound})`);
              } catch (error) {
                throw new Error(`Invalid compound "${compound}" from :has() selector "${selector}": ${String(error)}`);
              }
            }
          }
          i = end;
        }
      };
      const walk = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule && rule.selectorText.includes(":has(")) inspectSelector(rule.selectorText);
          if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
        }
      };
      for (const sheet of document.styleSheets) {
        try { walk(sheet.cssRules); }
        catch (error) { if (!(error instanceof DOMException && error.name === "SecurityError")) throw error; }
      }
      return found;
    });
    expect(offenders, `Descendant :has() selectors matching ${path}'s Recent list ancestors:\n${offenders.join("\n")}`).toEqual([]);
  });
}
