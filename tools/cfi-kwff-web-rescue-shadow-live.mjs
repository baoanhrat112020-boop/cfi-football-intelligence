#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runWebRescueShadowInjection } from './cfi-web-rescue-shadow-injection.mjs';

const clean = value => String(value ?? '').trim();
const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_OUTPUT = resolve('audit-reports/cfi-kwff-web-rescue-shadow-live.json');

function parts(ms, timeZone) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const get = type => values.find(item => item.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`
  };
}

function normalizeLines(text) {
  return clean(text)
    .split(/\r?\n/)
    .map(line => line.replace(/\bImage\b/gi, '').trim())
    .filter(Boolean);
}

function isNoiseLine(line) {
  const value = clean(line);
  return !value ||
    /^\d+R$/i.test(value) ||
    /^(?:Match Center|매치센터)$/i.test(value) ||
    /^(?:VS|Upcoming|경기예정|VS\s+Upcoming|VS\s+경기예정)$/i.test(value);
}

export function parseKwffMatchCardText(text, { year } = {}) {
  const lines = normalizeLines(text);
  const dateIndex = lines.findIndex(line => /\b\d{2}\.\d{2}\.(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|월|화|수|목|금|토|일)?\s*\d{2}:\d{2}\b/i.test(line));
  if (dateIndex < 0) return { accepted: false, reason: 'DATE_TIME_NOT_FOUND', lines };

  const dateMatch = lines[dateIndex].match(/\b(\d{2})\.(\d{2})\.(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|월|화|수|목|금|토|일)?\s*(\d{2}):(\d{2})\b/i);
  if (!dateMatch) return { accepted: false, reason: 'DATE_TIME_PARSE_FAILED', lines };

  const statusIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^(?:VS|Upcoming|경기예정|VS\s+Upcoming|VS\s+경기예정)$/i.test(line))
    .map(item => item.index);
  if (!statusIndexes.length) return { accepted: false, reason: 'UPCOMING_STATUS_NOT_FOUND', lines };

  const statusStart = Math.min(...statusIndexes);
  const statusEnd = Math.max(...statusIndexes);
  const beforeStatus = lines.slice(dateIndex + 1, statusStart).filter(line => !isNoiseLine(line));
  const afterStatus = lines.slice(statusEnd + 1).filter(line => !isNoiseLine(line));
  const home = clean(beforeStatus.at(-1));
  const away = clean(afterStatus[0]);
  if (!home || !away || home === away) {
    return { accepted: false, reason: 'TEAM_PARSE_FAILED', lines, home: home || null, away: away || null };
  }

  const yyyy = Number(year);
  const month = dateMatch[1];
  const day = dateMatch[2];
  const hour = dateMatch[3];
  const minute = dateMatch[4];
  if (!Number.isInteger(yyyy) || yyyy < 2000 || yyyy > 2100) {
    return { accepted: false, reason: 'YEAR_INVALID', lines };
  }

  // South Korea is fixed UTC+09:00; this avoids any host-local timezone ambiguity.
  const kickoffMs = Date.parse(`${yyyy}-${month}-${day}T${hour}:${minute}:00+09:00`);
  if (!Number.isFinite(kickoffMs)) return { accepted: false, reason: 'KICKOFF_PARSE_FAILED', lines };

  return {
    accepted: true,
    home,
    away,
    scheduleDate: `${yyyy}-${month}-${day}`,
    displayedTime: `${hour}:${minute}`,
    kickoffIso: new Date(kickoffMs).toISOString(),
    lines
  };
}

async function saveJson(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

async function collectKwffCards(page, scheduleUrl) {
  const response = await page.goto(scheduleUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1_000);
  const cards = await page.evaluate(() => {
    const eventPath = /^\/matches\/\d+\/?$/;
    const anchors = [...document.querySelectorAll('a[href]')]
      .filter(anchor => {
        try {
          return eventPath.test(new URL(anchor.href, location.href).pathname);
        } catch {
          return false;
        }
      });
    const out = [];
    const seen = new Set();
    for (const anchor of anchors) {
      const href = new URL(anchor.href, location.href).href;
      if (seen.has(href)) continue;
      let node = anchor;
      let text = '';
      for (let depth = 0; depth < 10 && node; depth += 1, node = node.parentElement) {
        const candidateText = String(node.innerText || '').trim();
        if (!candidateText) continue;
        const eventLinks = [...node.querySelectorAll('a[href]')]
          .filter(link => {
            try {
              return eventPath.test(new URL(link.href, location.href).pathname);
            } catch {
              return false;
            }
          });
        const hasDateTime = /\b\d{2}\.\d{2}\.(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|월|화|수|목|금|토|일)?\s*\d{2}:\d{2}\b/i.test(candidateText);
        const hasUpcoming = /\bUpcoming\b|경기예정/i.test(candidateText);
        if (eventLinks.length === 1 && hasDateTime && hasUpcoming) {
          text = candidateText;
          break;
        }
      }
      if (text) {
        seen.add(href);
        out.push({ href, text });
      }
    }
    return out;
  });
  return {
    httpStatus: response?.status() ?? null,
    finalUrl: page.url(),
    cards
  };
}

export async function runKwffWebRescueShadowLive({
  targetDate,
  timeZone = DEFAULT_TIME_ZONE,
  outputFile = DEFAULT_OUTPUT,
  nowMs = Date.now()
} = {}) {
  const effectiveTargetDate = clean(targetDate) || parts(nowMs, timeZone).date;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(effectiveTargetDate)) throw new Error('CFI_TARGET_DATE_REQUIRED');
  const [year, month] = effectiveTargetDate.split('-');
  const scheduleUrl = `https://www.kwff.or.kr/wk-league/matches?month=${Number(month)}&year=${year}&lang=en`;
  const generatedAt = new Date(nowMs).toISOString();
  let browser;
  const reportBase = {
    contract: 'CFI_KWFF_WEB_RESCUE_SHADOW_LIVE_V1',
    generatedAt,
    targetDate: effectiveTargetDate,
    timeZone,
    provider: 'KWFF',
    scheduleUrl,
    sourceTierExpected: 'X',
    policy: {
      officialFederationEvidenceOnly: true,
      numericMatchCenterIdRequired: true,
      syntheticProviderIdAllowed: false,
      sourceTrustPromotionPerformed: false,
      registryInvoked: false,
      orchestratorInvoked: false,
      predictionExecutionAllowed: false,
      bigDbNetworkInvoked: false,
      bigDbWriteAllowed: false,
      productionMutationAllowed: false,
      runtimeFixtureDataCommitted: false,
      decisionUse: false
    }
  };

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ timezoneId: 'Asia/Seoul', locale: 'en-US' });
    const page = await context.newPage();
    const observed = await collectKwffCards(page, scheduleUrl);
    const candidates = [];
    const rejectedCards = [];
    for (const card of observed.cards) {
      const parsed = parseKwffMatchCardText(card.text, { year: Number(year) });
      if (!parsed.accepted) {
        rejectedCards.push({ href: card.href, reason: parsed.reason });
        continue;
      }
      const eventUrl = new URL(card.href);
      const match = eventUrl.pathname.replace(/\/+$/, '').match(/^\/matches\/(\d+)$/);
      if (!match) {
        rejectedCards.push({ href: card.href, reason: 'NUMERIC_MATCH_CENTER_ID_REQUIRED' });
        continue;
      }
      const kickoffMs = Date.parse(parsed.kickoffIso);
      const local = parts(kickoffMs, timeZone);
      if (parsed.scheduleDate !== effectiveTargetDate || local.date !== effectiveTargetDate) {
        rejectedCards.push({ href: card.href, reason: 'TARGET_DATE_MISMATCH', scheduleDate: parsed.scheduleDate, localDate: local.date });
        continue;
      }
      if (kickoffMs <= nowMs) {
        rejectedCards.push({ href: card.href, reason: 'KICKOFF_NOT_FUTURE', kickoffIso: parsed.kickoffIso });
        continue;
      }
      candidates.push({
        provider: 'KWFF',
        home: parsed.home,
        away: parsed.away,
        competition: 'WK League',
        country: 'South Korea',
        kickoffIso: parsed.kickoffIso,
        targetDate: effectiveTargetDate,
        status: 'scheduled',
        sourceUrls: [card.href, scheduleUrl],
        discoveredAt: generatedAt
      });
    }

    if (!candidates.length) {
      const report = {
        ...reportBase,
        status: 'DEGRADED_NO_CURRENT_FUTURE_MATCHES',
        source: { httpStatus: observed.httpStatus, finalUrl: observed.finalUrl, cards: observed.cards.length },
        candidates: 0,
        rejectedCards
      };
      await saveJson(outputFile, report);
      console.log(JSON.stringify(report));
      return report;
    }

    const temp = await mkdtemp(join(tmpdir(), 'cfi-kwff-shadow-live-'));
    try {
      const candidateFile = join(temp, 'candidates.json');
      await saveJson(candidateFile, { candidates });
      const harness = await runWebRescueShadowInjection({
        inputFile: candidateFile,
        targetDate: effectiveTargetDate,
        timeZone,
        keepTemp: false
      });
      const rows = Array.isArray(harness?.runtime?.rows) ? harness.runtime.rows : [];
      const derivations = Array.isArray(harness?.runtime?.providerIdDerivations) ? harness.runtime.providerIdDerivations : [];
      if (harness?.status !== 'PASS') throw new Error(`KWFF_SHADOW_HARNESS_NOT_PASS:${harness?.status}`);
      if (rows.length !== candidates.length) throw new Error(`KWFF_SHADOW_ACCEPTED_MISMATCH:${candidates.length}:${rows.length}`);
      if (derivations.length !== candidates.length) throw new Error(`KWFF_SHADOW_PROVIDER_ID_DERIVATION_MISMATCH:${candidates.length}:${derivations.length}`);
      if (rows.some(row => row?.sourceTier !== 'X' || row?.sourceKey !== 'UNKNOWN')) {
        throw new Error('KWFF_SHADOW_SOURCE_TRUST_PROMOTED');
      }
      if (rows.some(row => !/^KWFF:\d+$/.test(clean(row?.providerId)))) {
        throw new Error('KWFF_SHADOW_PROVIDER_ID_INVALID');
      }

      const report = {
        ...reportBase,
        status: 'PASS',
        source: { httpStatus: observed.httpStatus, finalUrl: observed.finalUrl, cards: observed.cards.length },
        candidates: candidates.length,
        rejectedCards,
        accepted: rows.length,
        providerIdDerivations: derivations.length,
        runtimeRows: rows,
        harness: {
          contract: harness.contract,
          actualRuntimePathExecuted: harness.runner?.actualRuntimePathExecuted === true,
          implementation: harness.runner?.implementation ?? null,
          registryInvoked: harness.isolation?.registryInvoked,
          bigDbNetworkInvoked: harness.isolation?.bigDbNetworkInvoked,
          productionMutationAllowed: harness.isolation?.productionMutationAllowed
        }
      };
      await saveJson(outputFile, report);
      console.log(JSON.stringify(report));
      return report;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  } catch (error) {
    const report = {
      ...reportBase,
      status: 'FAIL_LIVE_PROBE',
      error: error instanceof Error ? error.message : String(error)
    };
    await saveJson(outputFile, report);
    console.error(JSON.stringify(report));
    throw error;
  } finally {
    await browser?.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runKwffWebRescueShadowLive({
    targetDate: clean(process.env.CFI_TARGET_DATE),
    timeZone: clean(process.env.CFI_TIME_ZONE) || DEFAULT_TIME_ZONE,
    outputFile: resolve(clean(process.env.CFI_KWFF_SHADOW_LIVE_REPORT) || DEFAULT_OUTPUT)
  });
}
