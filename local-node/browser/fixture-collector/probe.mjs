import { chromium } from "playwright";

import {
  mkdir,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  resolve
} from "node:path";

import {
  BROWSER_FIXTURE_SOURCES
} from "./source-registry.mjs";

const OUTPUT = resolve(
  "local-node/cache/browser/source-probe-audit.json"
);

async function saveJson(path, value) {
  await mkdir(
    dirname(path),
    { recursive: true }
  );

  await writeFile(
    path,
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

function detectBlock(text) {
  const normalized =
    String(text ?? "").toLowerCase();

  const markers = [
    "verify you are human",
    "access denied",
    "captcha",
    "checking your browser",
    "unusual traffic",
    "temporarily blocked"
  ];

  return markers.find(
    marker =>
      normalized.includes(marker)
  ) ?? null;
}

console.log(
  "CFI BROWSER SOURCE PROBE"
);

console.log(
  "MODE: READ_ONLY_BROWSER"
);

console.log("");

const browser =
  await chromium.launch({
    headless: true
  });

const results = [];

try {
  for (
    const source of
    BROWSER_FIXTURE_SOURCES
  ) {
    const context =
      await browser.newContext({
        locale: "en-GB",
        timezoneId: "UTC",
        viewport: {
          width: 1440,
          height: 1200
        }
      });

    const page =
      await context.newPage();

    const startedAt =
      Date.now();

    try {
      const response =
        await page.goto(
          source.url,
          {
            waitUntil:
              "domcontentloaded",
            timeout: 45000
          }
        );

      await page.waitForTimeout(2500);

      const title =
        await page.title();

      const bodyText =
        await page
          .locator("body")
          .innerText({
            timeout: 15000
          });

      const blockMarker =
        detectBlock(bodyText);

      const bodyTextLength =
        bodyText.length;

      const hasFixtureKeyword =
        /\b(fixtures?|scheduled|matches|games)\b/i
          .test(bodyText);

      const hasTargetMarker =
        new RegExp(
          source.target_class
            .replaceAll("_", ".?"),
          "i"
        ).test(
          [
            title,
            bodyText.slice(0, 5000)
          ].join(" ")
        );

      const snapshotPath =
        resolve(
          "local-node/cache/browser/probes",
          `${source.id}.txt`
        );

      await mkdir(
        dirname(snapshotPath),
        { recursive: true }
      );

      await writeFile(
        snapshotPath,
        bodyText.slice(0, 30000),
        "utf8"
      );

      const result = {
        source_id:
          source.id,

        provider:
          source.provider,

        target_class:
          source.target_class,

        requested_url:
          source.url,

        final_url:
          page.url(),

        http_status:
          response?.status() ?? null,

        title,

        bodyTextLength,

        hasFixtureKeyword,

        hasTargetMarker,

        blocked:
          Boolean(blockMarker),

        blockMarker,

        elapsedMs:
          Date.now() -
          startedAt,

        snapshot:
          snapshotPath,

        fixtureParsingAttempted:
          false,

        candidateGenerationAttempted:
          false,

        bigDbWriteAttempted:
          false
      };

      results.push(result);

      console.log({
        source:
          source.id,

        status:
          result.http_status,

        bodyChars:
          bodyTextLength,

        fixtureKeyword:
          hasFixtureKeyword,

        blocked:
          result.blocked
      });

    } catch (error) {
      const result = {
        source_id:
          source.id,

        provider:
          source.provider,

        target_class:
          source.target_class,

        requested_url:
          source.url,

        status: "ERROR",

        error: String(
          error?.message ??
          error
        ),

        fixtureParsingAttempted:
          false,

        candidateGenerationAttempted:
          false,

        bigDbWriteAttempted:
          false
      };

      results.push(result);

      console.log({
        source:
          source.id,

        status:
          "ERROR",

        error:
          result.error
      });

    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const successful =
  results.filter(
    r =>
      typeof r.http_status ===
        "number" &&
      r.http_status >= 200 &&
      r.http_status < 400 &&
      !r.blocked &&
      r.bodyTextLength > 500
  );

const blocked =
  results.filter(
    r => r.blocked
  );

const errors =
  results.filter(
    r => r.status === "ERROR"
  );

const audit = {
  contract:
    "CFI_BROWSER_SOURCE_PROBE_V1",

  generatedAt:
    new Date().toISOString(),

  status:
    successful.length > 0
      ? (
          errors.length === 0 &&
          blocked.length === 0
            ? "PASS"
            : "PASS_WITH_SOURCE_FAILURES"
        )
      : "FAIL",

  sourcesConfigured:
    BROWSER_FIXTURE_SOURCES.length,

  sourcesSuccessful:
    successful.length,

  sourcesBlocked:
    blocked.length,

  sourcesErrored:
    errors.length,

  fixtureParsingAttempted:
    false,

  candidateGenerationAttempted:
    false,

  predictionGenerated:
    false,

  oddsGenerated:
    false,

  bigDbWriteAllowed:
    false,

  bigDbWriteAttempted:
    false,

  results
};

await saveJson(
  OUTPUT,
  audit
);

console.log("");

console.log(
  "CFI BROWSER SOURCE PROBE SUMMARY"
);

console.log({
  status:
    audit.status,

  sourcesConfigured:
    audit.sourcesConfigured,

  sourcesSuccessful:
    audit.sourcesSuccessful,

  sourcesBlocked:
    audit.sourcesBlocked,

  sourcesErrored:
    audit.sourcesErrored,

  bigDbWriteAllowed:
    false,

  bigDbWriteAttempted:
    false
});

console.log("");

console.log(
  `Audit written to: ${OUTPUT}`
);
