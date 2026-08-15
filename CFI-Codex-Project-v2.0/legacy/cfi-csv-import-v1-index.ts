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

  const mm = String(Number(m[2])).padStart(2, "0");
  const dd = String(Number(m[1])).padStart(2, "0");

  return `${year}-${mm}-${dd}`;
}

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

    const response = await fetch(csvUrl);

    if (!response.ok) {
      return json({
        error: "CSV_FETCH_FAILED",
        status: response.status
      }, 400);
    }

    const csv = (await response.text()).replace(/^\uFEFF/, "");
    const lines = csv.split(/\r?\n/).filter(Boolean);

    if (lines.length < 2) {
      return json({ error: "CSV_EMPTY" }, 400);
    }

    const headers = parseCsvLine(lines[0]).map(x => x.trim());

    const required = [
      "Date",
      "HomeTeam",
      "AwayTeam",
      "FTHG",
      "FTAG",
      "HTHG",
      "HTAG"
    ];

    for (const col of required) {
      if (!headers.includes(col)) {
        return json({
          error: "MISSING_COLUMN",
          column: col
        }, 400);
      }
    }

    const idx = Object.fromEntries(
      headers.map((h, i) => [h, i])
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const counters = {
      rows: 0,
      NEW: 0,
      DUPLICATE_COMPATIBLE: 0,
      COMPLEMENTARY: 0,
      CONFLICT: 0,
      REJECTED: 0,
      ERROR: 0,
    };

    const samples = [];

    for (let n = 1; n < lines.length; n++) {
      const cols = parseCsvLine(lines[n]);

      if (cols.length < headers.length) {
        counters.REJECTED++;
        continue;
      }

      counters.rows++;

      const matchDate = parseDateDDMMYYYY(cols[idx.Date]);
      const homeTeam = cols[idx.HomeTeam]?.trim();
      const awayTeam = cols[idx.AwayTeam]?.trim();

      const ftHome = Number(cols[idx.FTHG]);
      const ftAway = Number(cols[idx.FTAG]);
      const htHome = Number(cols[idx.HTHG]);
      const htAway = Number(cols[idx.HTAG]);

      if (
        !matchDate ||
        !homeTeam ||
        !awayTeam ||
        !Number.isInteger(ftHome) ||
        !Number.isInteger(ftAway) ||
        !Number.isInteger(htHome) ||
        !Number.isInteger(htAway)
      ) {
        counters.REJECTED++;
        continue;
      }

      const { data, error } = await supabase.rpc("cfi_upsert_fixture", {
        p_match_date: matchDate,
        p_home_team: homeTeam,
        p_away_team: awayTeam,
        p_ht_home: htHome,
        p_ht_away: htAway,
        p_ft_home: ftHome,
        p_ft_away: ftAway,
        p_source_type: "CSV",
        p_source_label: csvUrl,
        p_image_hash: null,
      });

      if (error) {
        counters.ERROR++;
        continue;
      }

      const status = data?.status || "ERROR";

      if (status in counters) {
        counters[status]++;
      } else {
        counters.ERROR++;
      }

      if (samples.length < 5) {
        samples.push({
          matchDate,
          homeTeam,
          awayTeam,
          ht: `${htHome}-${htAway}`,
          ft: `${ftHome}-${ftAway}`,
          status
        });
      }
    }

    return json({
      status: "OK",
      csvUrl,
      counters,
      samples
    });

  } catch (error) {
    return json({
      error: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});