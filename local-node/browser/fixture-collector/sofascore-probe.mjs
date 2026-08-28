import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  SOFASCORE_CROSSCHECK_SOURCES
} from "./sofascore-source-registry.mjs";

const AUDIT_FILE = resolve(
  "local-node/cache/browser/sofascore-probe-audit.json"
);

async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function detectBlock(text) {
  const value = String(text ?? "").toLowerCase();

  return [
    "verify you are human",
    "access denied",
    "captcha",
    "checking your browser",
    "unusual traffic"
  ].find(x => value.includes(x)) ?? null;
}

console.log("CFI SOFASCORE CROSSCHECK PROBE");
console.log("MODE: READ_ONLY_BROWSER");
console.log("");

const browser = await chromium.launch({
  headless: true
});

const results = [];

try {
  for (const source of SOFASCORE_CROSSCHECK_SOURCES) {
    const context = await browser.newContext({
      locale: "en-GB",
      timezoneId: "UTC",
      viewport: {
        width: 1440,
        height: 1400
      }
    });

    const page = await context.newPage();

    try {
      const response = await page.goto(
        source.url,
        {
          waitUntil: "domcontentloaded",
          timeout: 45000
        }
      );

      await page.waitForTimeout(5000);

      const title = await page.title();

      const body = await page.locator("body").innerText({
        timeout: 15000
      });

      const blockMarker = detectBlock(body);

      const snapshot = resolve(
        "local-node/cache/browser/probes",
        source.id + ".txt"
      );

      await mkdir(dirname(snapshot), {
        recursive: true
      });

      await writeFile(
        snapshot,
        body.slice(0, 80000),
        "utf8"
      );

      const result = {
        source_id: source.id,
        provider: source.provider,
        tournament_id: source.tournament_id,
        target_class: source.target_class,

        requested_url: source.url,
        final_url: page.url(),

        http_status: response?.status() ?? null,
        title,

        bodyTextLength: body.length,

        blocked: Boolean(blockMarker),
        blockMarker,

        hasMatchesMarker:
          /\b(matches|fixtures|schedule|upcoming)\b/i.test(body),

        snapshot,

        fixtureParsingAttempted: false,
        candidateGenerationAttempted: false,
        predictionGenerated: false,
        oddsGenerated: false,
        bigDbWriteAttempted: false
      };

      results.push(result);

      console.log({
        source: source.id,
        http_status: result.http_status,
        bodyChars: result.bodyTextLength,
        blocked: result.blocked,
        matchesMarker: result.hasMatchesMarker
      });

    } catch (error) {
      results.push({
        source_id: source.id,
        status: "ERROR",
        error: String(error?.message ?? error)
      });

      console.log({
        source: source.id,
        status: "ERROR",
        error: String(error?.message ?? error)
      });

    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const successful = results.filter(
  r =>
    typeof r.http_status === "number" &&
    r.http_status >= 200 &&
    r.http_status < 400 &&
    !r.blocked &&
    r.bodyTextLength > 500
);

const audit = {
  contract: "CFI_SOFASCORE_CROSSCHECK_PROBE_V1",
  generatedAt: new Date().toISOString(),

  status:
    successful.length === SOFASCORE_CROSSCHECK_SOURCES.length
      ? "PASS"
      : successful.length > 0
        ? "PASS_WITH_SOURCE_FAILURES"
        : "FAIL",

  sourcesConfigured: SOFASCORE_CROSSCHECK_SOURCES.length,
  sourcesSuccessful: successful.length,
  sourcesBlocked: results.filter(x => x.blocked).length,
  sourcesErrored: results.filter(x => x.status === "ERROR").length,

  fixtureParsingAttempted: false,
  candidateGenerationAttempted: false,
  predictionGenerated: false,
  oddsGenerated: false,

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false,

  results
};

await saveJson(AUDIT_FILE, audit);

console.log("");
console.log("CFI SOFASCORE PROBE SUMMARY");
console.log({
  status: audit.status,
  sourcesConfigured: audit.sourcesConfigured,
  sourcesSuccessful: audit.sourcesSuccessful,
  sourcesBlocked: audit.sourcesBlocked,
  sourcesErrored: audit.sourcesErrored,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
});
