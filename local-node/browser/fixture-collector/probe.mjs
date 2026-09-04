import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BROWSER_FIXTURE_SOURCES } from './source-registry.mjs';

const OUTPUT = resolve('local-node/cache/browser/source-probe-audit.json');
const SNAPSHOT_MAX_CHARS = Math.max(30_000, Number(process.env.CFI_BROWSER_SNAPSHOT_MAX_CHARS ?? 500_000));
const SCROLL_STEPS = Math.max(0, Math.min(20, Number(process.env.CFI_BROWSER_PROBE_SCROLL_STEPS ?? 6)));

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

function detectBlock(text) {
  const normalized = String(text ?? '').toLowerCase();
  const markers = [
    'verify you are human',
    'access denied',
    'captcha',
    'checking your browser',
    'unusual traffic',
    'temporarily blocked'
  ];
  return markers.find(marker => normalized.includes(marker)) ?? null;
}

async function boundedAutoScroll(page, steps) {
  for (let index = 0; index < steps; index += 1) {
    const before = await page.evaluate(() => document.body?.scrollHeight ?? 0);
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight ?? 0));
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => document.body?.scrollHeight ?? 0);
    if (after <= before && index >= 1) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

console.log('CFI BROWSER SOURCE PROBE');
console.log('MODE: READ_ONLY_BROWSER');
console.log('');

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const source of BROWSER_FIXTURE_SOURCES) {
    const renderTimezone = source.render_timezone || 'Asia/Ho_Chi_Minh';
    const context = await browser.newContext({
      locale: 'en-GB',
      timezoneId: renderTimezone,
      viewport: { width: 1440, height: 1200 }
    });
    const page = await context.newPage();
    const startedAt = Date.now();

    try {
      const response = await page.goto(source.url, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000
      });
      await page.waitForTimeout(2_500);
      await boundedAutoScroll(page, source.discovery_scope === 'DAILY_BROAD' ? SCROLL_STEPS : Math.min(2, SCROLL_STEPS));

      const title = await page.title();
      const bodyText = await page.locator('body').innerText({ timeout: 15_000 });
      const blockMarker = detectBlock(bodyText);
      const bodyTextLength = bodyText.length;
      const hasFixtureKeyword = /\b(fixtures?|scheduled|matches|games)\b/i.test(bodyText);
      const targetPattern = source.target_class === 'ALL'
        ? /\b(football|soccer|match|fixture|live)\b/i
        : new RegExp(source.target_class.replaceAll('_', '.?'), 'i');
      const hasTargetMarker = targetPattern.test([title, bodyText.slice(0, 20_000)].join(' '));

      const snapshotPath = resolve('local-node/cache/browser/probes', `${source.id}.txt`);
      await mkdir(dirname(snapshotPath), { recursive: true });
      const snapshotText = bodyText.slice(0, SNAPSHOT_MAX_CHARS);
      await writeFile(snapshotPath, snapshotText, 'utf8');

      const result = {
        source_id: source.id,
        provider: source.provider,
        source_tier: source.source_tier ?? null,
        source_priority: source.source_priority ?? null,
        primary_coverage: source.primary_coverage ?? false,
        discovery_scope: source.discovery_scope ?? null,
        target_class: source.target_class,
        render_timezone: renderTimezone,
        requested_url: source.url,
        final_url: page.url(),
        http_status: response?.status() ?? null,
        title,
        bodyTextLength,
        snapshotChars: snapshotText.length,
        snapshotTruncated: bodyTextLength > snapshotText.length,
        scrollStepsConfigured: source.discovery_scope === 'DAILY_BROAD' ? SCROLL_STEPS : Math.min(2, SCROLL_STEPS),
        hasFixtureKeyword,
        hasTargetMarker,
        blocked: Boolean(blockMarker),
        blockMarker,
        elapsedMs: Date.now() - startedAt,
        snapshot: snapshotPath,
        fixtureParsingAttempted: false,
        candidateGenerationAttempted: false,
        bigDbWriteAttempted: false
      };
      results.push(result);
      console.log({
        source: source.id,
        status: result.http_status,
        bodyChars: bodyTextLength,
        snapshotChars: result.snapshotChars,
        truncated: result.snapshotTruncated,
        fixtureKeyword: hasFixtureKeyword,
        blocked: result.blocked
      });
    } catch (error) {
      const result = {
        source_id: source.id,
        provider: source.provider,
        source_tier: source.source_tier ?? null,
        source_priority: source.source_priority ?? null,
        primary_coverage: source.primary_coverage ?? false,
        discovery_scope: source.discovery_scope ?? null,
        target_class: source.target_class,
        render_timezone: renderTimezone,
        requested_url: source.url,
        status: 'ERROR',
        error: String(error?.message ?? error),
        fixtureParsingAttempted: false,
        candidateGenerationAttempted: false,
        bigDbWriteAttempted: false
      };
      results.push(result);
      console.log({ source: source.id, status: 'ERROR', error: result.error });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const successful = results.filter(row =>
  typeof row.http_status === 'number' &&
  row.http_status >= 200 && row.http_status < 400 &&
  !row.blocked && row.bodyTextLength > 500
);
const blocked = results.filter(row => row.blocked);
const errors = results.filter(row => row.status === 'ERROR');
const truncated = results.filter(row => row.snapshotTruncated);

const audit = {
  contract: 'CFI_BROWSER_SOURCE_PROBE_V2',
  generatedAt: new Date().toISOString(),
  status: successful.length > 0
    ? (errors.length === 0 && blocked.length === 0 ? 'PASS' : 'PASS_WITH_SOURCE_FAILURES')
    : 'FAIL',
  sourcesConfigured: BROWSER_FIXTURE_SOURCES.length,
  sourcesSuccessful: successful.length,
  sourcesBlocked: blocked.length,
  sourcesErrored: errors.length,
  snapshotsTruncated: truncated.length,
  snapshotMaxChars: SNAPSHOT_MAX_CHARS,
  boundedAutoScroll: true,
  fixtureParsingAttempted: false,
  candidateGenerationAttempted: false,
  predictionGenerated: false,
  oddsGenerated: false,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false,
  results
};

await saveJson(OUTPUT, audit);
console.log('');
console.log('CFI BROWSER SOURCE PROBE SUMMARY');
console.log({
  status: audit.status,
  sourcesConfigured: audit.sourcesConfigured,
  sourcesSuccessful: audit.sourcesSuccessful,
  sourcesBlocked: audit.sourcesBlocked,
  sourcesErrored: audit.sourcesErrored,
  snapshotsTruncated: audit.snapshotsTruncated,
  snapshotMaxChars: audit.snapshotMaxChars,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
});
console.log('');
console.log(`Audit written to: ${OUTPUT}`);
