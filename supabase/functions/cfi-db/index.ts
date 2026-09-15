import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cfi-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Private key used only between CFI GPT Action and this function.
  const expectedKey = Deno.env.get("CFI_ACTION_KEY");

  if (!expectedKey) {
    return json({ error: "SERVER_KEY_NOT_CONFIGURED" }, 500);
  }

  const suppliedKey = req.headers.get("x-cfi-key");

  if (suppliedKey !== expectedKey) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const url = new URL(req.url);
  const path = url.pathname.split("/").filter(Boolean).pop();
  const route = path === "cfi-db"? (req.method === "POST" ? "fixtures" : "status"): path;
  try {
    // =========================================================
    // STATUS
    // =========================================================
    if (req.method === "GET" && route === "status") {
      const [{ count: teamCount }, { count: fixtureCount }, { count: quarantineCount }] =
        await Promise.all([
          supabase
            .from("teams")
            .select("*", { count: "exact", head: true }),

          supabase
            .from("fixtures")
            .select("*", { count: "exact", head: true }),

          supabase
            .from("quarantine")
            .select("*", { count: "exact", head: true }),
        ]);

      const { count: completeHt } = await supabase
        .from("fixtures")
        .select("*", { count: "exact", head: true })
        .not("ht_home", "is", null)
        .not("ht_away", "is", null);

      const { count: completeFt } = await supabase
        .from("fixtures")
        .select("*", { count: "exact", head: true })
        .not("ft_home", "is", null)
        .not("ft_away", "is", null);

      return json({
        status: "OK",
        teams: teamCount ?? 0,
        canonicalFixtures: fixtureCount ?? 0,
        completeHT: completeHt ?? 0,
        completeFT: completeFt ?? 0,
        quarantinedConflicts: quarantineCount ?? 0,
      });
    }

    // =========================================================
    // FIXTURES BY DAY (READ-ONLY)
    // =========================================================
    if ((req.method === "GET" || req.method === "POST") && route === "fixtures-day") {
      let requestedDate = (url.searchParams.get("target_date") || "").slice(0, 10);

      if (req.method === "POST") {
        const body = await req.clone().json().catch(() => ({}));
        requestedDate = String(body?.target_date || requestedDate || "").slice(0, 10);
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
        return json({ error: "TARGET_DATE_INVALID" }, 400);
      }

      const { data: rows, error } = await supabase
        .from("fixtures")
        .select(`
          fixture_id,
          match_date,
          competition_key,
          competition_name,
          country,
          season,
          competition_segment,
          status,
          home_team_id,
          away_team_id,
          home:teams!fixtures_home_team_id_fkey(team_id,canonical_name),
          away:teams!fixtures_away_team_id_fkey(team_id,canonical_name)
        `)
        .eq("match_date", requestedDate)
        .order("fixture_id", { ascending: true })
        .limit(500);

      if (error) throw error;

      const canonicalFixtures = (rows || []).map((row: any) => ({
        provider: "CFI_BIGDB",
        providerId: String(row.fixture_id),
        home: row.home?.canonical_name || "",
        away: row.away?.canonical_name || "",
        competition: row.competition_name || row.competition_key || row.competition_segment || null,
        country: row.country || null,
        targetDate: requestedDate,
        kickoffIso: null,
        kickoffLocal: null,
        status: row.status || "CANONICAL",
        canonicalHomeTeamId: row.home_team_id || null,
        canonicalAwayTeamId: row.away_team_id || null,
        season: row.season || null,
        provenance: "PERSISTENT_DB_CANONICAL_FIXTURE",
        sourceProviders: ["CFI_BIGDB"]
      })).filter((row: any) => row.home && row.away);

      let bridgeFixtures: any[] = [];
      let bridgeFresh = false;
      let bridgeGeneratedAt: string | null = null;

      try {
        const path = `runtime/fixture-discovery-AISCORE-${requestedDate}.json`;
        const { data: blob, error: bridgeError } = await supabase.storage
          .from("cfi-pc-bridge-v1")
          .download(path);

        if (!bridgeError && blob) {
          const manifest = JSON.parse(await blob.text());
          bridgeGeneratedAt = String(manifest?.generatedAt || "");
          const ageMs = Date.now() - Date.parse(bridgeGeneratedAt);
          bridgeFresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 45 * 60 * 1000;

          if (
            bridgeFresh &&
            String(manifest?.targetDate || "") === requestedDate &&
            Array.isArray(manifest?.fixtures)
          ) {
            bridgeFixtures = manifest.fixtures.slice(0, 500).map((row: any) => ({
              provider: "AISCORE",
              providerId: String(row?.providerId || ""),
              home: String(row?.home || "").trim(),
              away: String(row?.away || "").trim(),
              competition: row?.competition ? String(row.competition) : null,
              country: row?.country ? String(row.country) : null,
              targetDate: requestedDate,
              kickoffIso: row?.kickoffIso ? String(row.kickoffIso) : null,
              kickoffLocal: row?.kickoffLocal ? String(row.kickoffLocal) : null,
              status: String(row?.status || "scheduled"),
              canonicalHomeTeamId: null,
              canonicalAwayTeamId: null,
              provenance: "PC_NODE_AISCORE_BRIDGE",
              sourceUrls: Array.isArray(row?.sourceUrls) ? row.sourceUrls.slice(0, 6) : [],
              sourceProviders: ["AISCORE"]
            })).filter((row: any) => row.providerId && row.home && row.away);
          }
        }
      } catch {
        bridgeFixtures = [];
      }

      const merged = new Map<string, any>();
      const keyOf = (row: any) => [
        foldName(String(row?.home || "")),
        foldName(String(row?.away || "")),
        requestedDate
      ].join("|");

      for (const row of canonicalFixtures) {
        merged.set(keyOf(row), row);
      }

      for (const row of bridgeFixtures) {
        const key = keyOf(row);
        const current = merged.get(key);

        if (!current) {
          merged.set(key, row);
          continue;
        }

        merged.set(key, {
          ...current,
          kickoffIso: current.kickoffIso || row.kickoffIso || null,
          kickoffLocal: current.kickoffLocal || row.kickoffLocal || null,
          competition: current.competition || row.competition || null,
          country: current.country || row.country || null,
          sourceProviders: [...new Set([...(current.sourceProviders || [current.provider]), "AISCORE"])],
          sourceUrls: row.sourceUrls || []
        });
      }

      const fixtures = [...merged.values()].sort((a: any, b: any) =>
        String(a.kickoffLocal || "99:99").localeCompare(String(b.kickoffLocal || "99:99"))
        || String(a.home).localeCompare(String(b.home))
      );

      return json({
        status: "OK",
        version: "CFI_DB_FIXTURES_DAY_V2_AISCORE_BRIDGE",
        targetDate: requestedDate,
        source: bridgeFixtures.length ? "CFI_BIGDB_PLUS_AISCORE_BRIDGE" : "CFI_BIGDB",
        count: fixtures.length,
        canonicalCount: canonicalFixtures.length,
        aiScoreBridgeCount: bridgeFixtures.length,
        aiScoreBridgeFresh: bridgeFresh,
        aiScoreBridgeGeneratedAt: bridgeGeneratedAt,
        rows: fixtures,
        readOnly: true,
        canonicalWriteAttempted: false
      });
    }

    // =========================================================
    // TEAM HISTORY
    // =========================================================
    if (req.method === "GET" && route === "team-history") {
      const team = (url.searchParams.get("team") || "").trim();

      if (!team) {
        return json({ error: "TEAM_REQUIRED" }, 400);
      }

      const { data: teamRow, error: teamError } = await supabase
        .from("teams")
        .select("team_id,canonical_name")
        .eq("canonical_name", team)
        .maybeSingle();

      if (teamError) throw teamError;

      if (!teamRow) {
        return json({
          status: "NOT_FOUND",
          team,
          fixtures: [],
        });
      }

      const { data: rows, error } = await supabase
        .from("fixtures")
        .select(`
          fixture_id,
          match_date,
          ht_home,
          ht_away,
          ft_home,
          ft_away,
          status,
          home:teams!fixtures_home_team_id_fkey(team_id,canonical_name),
          away:teams!fixtures_away_team_id_fkey(team_id,canonical_name)
        `)
        .or(`home_team_id.eq.${teamRow.team_id},away_team_id.eq.${teamRow.team_id}`)
        .order("match_date", { ascending: false });

      if (error) throw error;

      return json({
        status: "OK",
        team: teamRow.canonical_name,
        count: rows?.length ?? 0,
        fixtures: rows ?? [],
      });
    }

    // =========================================================
    // H2H
    // =========================================================
    if (req.method === "GET" && route === "h2h") {
      const home = (url.searchParams.get("home") || "").trim();
      const away = (url.searchParams.get("away") || "").trim();

      if (!home || !away) {
        return json({ error: "HOME_AND_AWAY_REQUIRED" }, 400);
      }

      const { data: teams, error: teamError } = await supabase
        .from("teams")
        .select("team_id,canonical_name")
        .in("canonical_name", [home, away]);

      if (teamError) throw teamError;

      const homeTeam = teams?.find((x) => x.canonical_name === home);
      const awayTeam = teams?.find((x) => x.canonical_name === away);

      if (!homeTeam || !awayTeam) {
        return json({
          status: "NOT_FOUND",
          home,
          away,
          fixtures: [],
        });
      }

      const { data: rows, error } = await supabase
        .from("fixtures")
        .select(`
          fixture_id,
          match_date,
          ht_home,
          ht_away,
          ft_home,
          ft_away,
          status,
          home:teams!fixtures_home_team_id_fkey(team_id,canonical_name),
          away:teams!fixtures_away_team_id_fkey(team_id,canonical_name)
        `)
        .or(
          `and(home_team_id.eq.${homeTeam.team_id},away_team_id.eq.${awayTeam.team_id}),` +
          `and(home_team_id.eq.${awayTeam.team_id},away_team_id.eq.${homeTeam.team_id})`
        )
        .order("match_date", { ascending: false });

      if (error) throw error;

      return json({
        status: "OK",
        home,
        away,
        count: rows?.length ?? 0,
        fixtures: rows ?? [],
      });
    }

    // =========================================================
    // UPSERT ONE OR MANY FIXTURES
    // =========================================================
    if (req.method === "POST" && route === "fixtures") {
      const body = await req.json();

      const fixtures = Array.isArray(body.fixtures)
        ? body.fixtures
        : body.fixture
          ? [body.fixture]
          : [];

      if (!fixtures.length) {
        return json({ error: "FIXTURES_REQUIRED" }, 400);
      }

      if (fixtures.length > 100) {
        return json({ error: "MAX_100_FIXTURES_PER_REQUEST" }, 400);
      }

      const results = [];

      for (const f of fixtures) {
        const { data, error } = await supabase.rpc("cfi_upsert_fixture", {
          p_match_date: f.matchDate,
          p_home_team: f.homeTeam,
          p_away_team: f.awayTeam,

          p_ht_home:
            Number.isInteger(f?.ht?.home) ? f.ht.home : null,
          p_ht_away:
            Number.isInteger(f?.ht?.away) ? f.ht.away : null,

          p_ft_home:
            Number.isInteger(f?.ft?.home) ? f.ft.home : null,
          p_ft_away:
            Number.isInteger(f?.ft?.away) ? f.ft.away : null,

          p_source_type: f.sourceType || "SCREENSHOT",
          p_source_label: f.sourceLabel || null,
          p_image_hash: f.imageHash || null,
        });

        if (error) {
          results.push({
            status: "ERROR",
            fixture: f,
            error: error.message,
          });
        } else {
          results.push({
            fixture: f,
            result: data,
          });
        }
      }

      const counters = {
        NEW: 0,
        DUPLICATE_COMPATIBLE: 0,
        COMPLEMENTARY: 0,
        CONFLICT: 0,
        REJECTED: 0,
        ERROR: 0,
      };

      for (const item of results) {
        const s =
          item?.result?.status ||
          item?.status ||
          "ERROR";

        if (s in counters) counters[s]++;
        else counters.ERROR++;
      }

      return json({
        status: "OK",
        received: fixtures.length,
        counters,
        results,
      });
    }

    return json({ error: "NOT_FOUND" }, 404);
  } catch (error) {
    console.error(error);

    return json(
      {
        error: "INTERNAL_ERROR",
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500
    );
  }
});