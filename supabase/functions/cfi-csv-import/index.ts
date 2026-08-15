import { createClient } from "npm:@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }

  out.push(cur);
  return out;
}

function parseDateDDMMYYYY(value: string) {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;

  let year = Number(m[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;

  const month = Number(m[2]);
  const day = Number(m[1]);

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseScore(value: string | undefined) {
  if (value == null) return null;
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return null;

  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

type Fixture = {
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  ht: { home: number; away: number };
  ft: { home: number; away: number };
  sourceType: string;
  sourceLabel: string;
  imageHash: null;
};

const BATCH_SIZE = 500;

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "POST_REQUIRED" }, 405);
    }

    const expectedKey = Deno.env.get("CFI_ACTION_KEY");
    const suppliedKey = req.headers.get("x-cfi-key");

    if (!expectedKey || suppliedKey !== expectedKey) {
      return json({ error: "UNAUTHORIZED" }, 401);
    }

    const body = await req.json();
    const csvUrl = String(body.csvUrl || "").trim();

    if (!csvUrl.startsWith("https://")) {
      return json({ error: "VALID_HTTPS_CSV_URL_REQUIRED" }, 400);
    }

    const response = await fetch(csvUrl, {
      headers: {
        "User-Agent": "CFI-Football-Intelligence/2.0",
        "Accept": "text/csv,text/plain,*/*",
      },
    });

    if (!response.ok) {
      return json({
        error: "CSV_FETCH_FAILED",
        status: response.status,
      }, 400);
    }

    const csv = (await response.text()).replace(/^\uFEFF/, "");
    const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== "");

    if (lines.length < 2) {
      return json({ error: "CSV_EMPTY" }, 400);
    }

    const headers = parseCsvLine(lines[0]).map((x) => x.trim());

    const required = [
      "Date",
      "HomeTeam",
      "AwayTeam",
      "FTHG",
      "FTAG",
      "HTHG",
      "HTAG",
    ];

    for (const col of required) {
      if (!headers.includes(col)) {
        return json({
          error: "MISSING_COLUMN",
          column: col,
        }, 400);
      }
    }

    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRole) {
      return json({ error: "SUPABASE_SERVER_SECRET_MISSING" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const fixtures: Fixture[] = [];
    const samples: Array<Record<string, unknown>> = [];
    let parseRejected = 0;

    for (let n = 1; n < lines.length; n++) {
      const cols = parseCsvLine(lines[n]);

      if (cols.length < headers.length) {
        parseRejected++;
        continue;
      }

      const matchDate = parseDateDDMMYYYY(cols[idx.Date] ?? "");
      const homeTeam = (cols[idx.HomeTeam] ?? "").trim();
      const awayTeam = (cols[idx.AwayTeam] ?? "").trim();

      const ftHome = parseScore(cols[idx.FTHG]);
      const ftAway = parseScore(cols[idx.FTAG]);
      const htHome = parseScore(cols[idx.HTHG]);
      const htAway = parseScore(cols[idx.HTAG]);

      // This importer only sends complete completed fixtures to the canonical DB.
      // Blank/unplayed/malformed score rows are rejected, never converted to 0.
      if (
        !matchDate ||
        !homeTeam ||
        !awayTeam ||
        homeTeam === awayTeam ||
        ftHome === null ||
        ftAway === null ||
        htHome === null ||
        htAway === null
      ) {
        parseRejected++;
        continue;
      }

      // Basic football score integrity: a team's HT goals cannot exceed its FT goals.
      if (htHome > ftHome || htAway > ftAway) {
        parseRejected++;
        continue;
      }

      const fixture: Fixture = {
        matchDate,
        homeTeam,
        awayTeam,
        ht: { home: htHome, away: htAway },
        ft: { home: ftHome, away: ftAway },
        sourceType: "CSV",
        sourceLabel: csvUrl,
        imageHash: null,
      };

      fixtures.push(fixture);

      if (samples.length < 5) {
        samples.push({
          matchDate,
          homeTeam,
          awayTeam,
          ht: `${htHome}-${htAway}`,
          ft: `${ftHome}-${ftAway}`,
        });
      }
    }

    if (fixtures.length === 0) {
      return json({
        status: "OK",
        csvUrl,
        counters: {
          rows: 0,
          NEW: 0,
          DUPLICATE_COMPATIBLE: 0,
          COMPLEMENTARY: 0,
          CONFLICT: 0,
          REJECTED: parseRejected,
          ERROR: 0,
        },
        samples,
      });
    }

    const counters = {
      rows: 0,
      NEW: 0,
      DUPLICATE_COMPATIBLE: 0,
      COMPLEMENTARY: 0,
      CONFLICT: 0,
      REJECTED: parseRejected,
      ERROR: 0,
    };

    for (let start = 0; start < fixtures.length; start += BATCH_SIZE) {
      const batch = fixtures.slice(start, start + BATCH_SIZE);

      const { data, error } = await supabase.rpc("cfi_upsert_fixtures_batch", {
        p_fixtures: batch,
      });

      if (error) {
        return json({
          error: "BATCH_RPC_FAILED",
          message: error.message,
          batchStart: start,
          batchSize: batch.length,
        }, 500);
      }

      const c = data?.counters;
      if (!c) {
        return json({
          error: "INVALID_BATCH_RESPONSE",
          batchStart: start,
          batchSize: batch.length,
          data,
        }, 500);
      }

      counters.rows += Number(c.rows ?? 0);
      counters.NEW += Number(c.NEW ?? 0);
      counters.DUPLICATE_COMPATIBLE += Number(c.DUPLICATE_COMPATIBLE ?? 0);
      counters.COMPLEMENTARY += Number(c.COMPLEMENTARY ?? 0);
      counters.CONFLICT += Number(c.CONFLICT ?? 0);
      counters.REJECTED += Number(c.REJECTED ?? 0);
      counters.ERROR += Number(c.ERROR ?? 0);
    }

    return json({
      status: "OK",
      csvUrl,
      parsedFixtures: fixtures.length,
      rejectedBeforeDb: parseRejected,
      batches: Math.ceil(fixtures.length / BATCH_SIZE),
      counters,
      samples,
    });
  } catch (error) {
    return json({
      error: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
