import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MARKETS = ["7ft", "oft", "3ht", "oht"] as const;
const GLOBAL_MEANS: Record<string, number> = {
  "7ft": 0.021209842611559105,
  "oft": 0.034550263178364925,
  "3ht": 0.1133352347862162,
  "oht": 0.00825835558897503,
};
const TOL = 0.0001;
let MODELS: any = null;
let EDGE_CELLS: any = null;

async function loadModels() {
  if (MODELS) return MODELS;
  const { data } = await supabase.storage.from("cfi-models").download("cfi_models.json");
  MODELS = JSON.parse(await data!.text());
  return MODELS;
}

async function loadEdgeCells() {
  if (EDGE_CELLS) return EDGE_CELLS;
  const { data } = await supabase.from("cfi_edge_cells").select("*");
  EDGE_CELLS = {};
  for (const r of data || []) {
    EDGE_CELLS[`${r.cell}|${r.market}`] = r;
  }
  return EDGE_CELLS;
}

function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)); }
function walkTree(tree: any, f: number[]): number {
  let n = 0;
  while (tree.children_left[n] !== -1) {
    const fi = tree.feature[n];
    n = f[fi] <= tree.threshold[n] ? tree.children_left[n] : tree.children_right[n];
  }
  return tree.value[n];
}
function predictGB(t: any, f: number[]): number {
  let raw = t.init_prediction;
  for (const tree of t.trees) raw += t.learning_rate * walkTree(tree, f);
  return sigmoid(raw);
}
function calibrate(p: number, cal: any): number {
  const xs = cal.x_thresholds, ys = cal.y_thresholds;
  if (!xs?.length) return p;
  if (p <= xs[0]) return ys[0];
  if (p >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++) {
    if (p <= xs[i + 1]) {
      const t = (p - xs[i]) / (xs[i + 1] - xs[i]);
      return ys[i] + t * (ys[i + 1] - ys[i]);
    }
  }
  return ys[ys.length - 1];
}
function isRealRow(r: any): boolean {
  return r && typeof r === "object" && "fixture_id" in r && r.fixture_id;
}
function isFallback(val: any, market: string): boolean {
  if (val === null || val === undefined) return true;
  return Math.abs(Number(val) - GLOBAL_MEANS[market]) < TOL;
}
function getStrBucket(gap: number): string {
  if (gap <= 0.3) return "even";
  if (gap <= 1.0) return "small";
  if (gap <= 2.0) return "mid";
  return "big";
}

serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { fixture_id } = await req.json();
    if (!fixture_id) return new Response(JSON.stringify({ error: "missing fixture_id" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const models = await loadModels();
    const edgeCells = await loadEdgeCells();

    const { data: featRaw } = await supabase
      .from("cfi_fixture_features")
      .select("*")
      .eq("fixture_id", fixture_id)
      .maybeSingle();
    const feat = isRealRow(featRaw) ? featRaw : null;

    let fix: any, featuresFromDB: any = null, leagueKey: string | null = null;
    if (feat) {
      fix = feat;
      featuresFromDB = feat;
      leagueKey = feat.competition_key;
    } else {
      const { data: liveRaw } = await supabase
        .from("fixtures")
        .select("fixture_id, match_date, home_team_id, away_team_id, competition_key")
        .eq("fixture_id", fixture_id)
        .maybeSingle();
      const live = isRealRow(liveRaw) ? liveRaw : null;
      if (!live) return new Response(JSON.stringify({ error: "fixture not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
      fix = live;
      leagueKey = live.competition_key;
    }

    let prior: any = null;
    if (leagueKey) {
      const { data: pRaw } = await supabase
        .from("cfi_league_priors").select("*")
        .eq("competition_key", leagueKey).maybeSingle();
      prior = isRealRow(pRaw) ? pRaw : null;
    }

    const month = new Date(fix.match_date).getUTCMonth() + 1;
    const phase = [8,9,10].includes(month) ? "early" : ([11,12,1,2].includes(month) ? "mid" : "late");

    // Compute strength gap from features
    const homeStr = featuresFromDB?.feat_home_ftavg ?? prior?.avg_ft_total ?? 2.5;
    const awayStr = featuresFromDB?.feat_away_ftavg ?? prior?.avg_ft_total ?? 2.5;
    const strGap = Math.abs(homeStr - awayStr);
    const strBucket = getStrBucket(strGap);
    const cellKey = `${leagueKey}|${phase}|${strBucket}`;

    const predictions: Record<string, any> = {};
    for (const market of MARKETS) {
      const model = models[market];
      if (!model) continue;

      const priorRate = prior ? Number(prior[`prior_${market}`] ?? model.base_rate) : model.base_rate;
      const priorFtAvg = prior ? Number(prior.avg_ft_total ?? 2.5) : 2.5;
      const priorHtAvg = prior ? Number(prior.avg_ht_total ?? 1.2) : 1.2;

      const fm: Record<string, number> = {
        [`feat_home_${market}`]: featuresFromDB?.[`feat_home_${market}`] ?? priorRate,
        [`feat_away_${market}`]: featuresFromDB?.[`feat_away_${market}`] ?? priorRate,
        [`feat_league_${market}`]: featuresFromDB?.[`feat_league_${market}`] ?? priorRate,
        feat_home_ftavg: featuresFromDB?.feat_home_ftavg ?? priorFtAvg,
        feat_away_ftavg: featuresFromDB?.feat_away_ftavg ?? priorFtAvg,
        feat_home_htavg: featuresFromDB?.feat_home_htavg ?? priorHtAvg,
        feat_away_htavg: featuresFromDB?.feat_away_htavg ?? priorHtAvg,
        phase_early: phase === "early" ? 1 : 0,
        phase_mid: phase === "mid" ? 1 : 0,
        phase_late: phase === "late" ? 1 : 0,
      };

      const features = model.feature_cols.map((c: string) => fm[c] ?? 0);
      const rawP = predictGB(model.trees, features);
      const calP = calibrate(rawP, model.calibration);

      const hFallback = isFallback(featuresFromDB?.[`feat_home_${market}`], market);
      const aFallback = isFallback(featuresFromDB?.[`feat_away_${market}`], market);

      // Base confidence
      let conf = model.confidence;
      let sourceDetail = "features";
      if (!featuresFromDB) {
        conf = "VERY_LOW";
        sourceDetail = prior ? `fallback_${prior.source}` : "fallback_global";
      } else if (hFallback && aFallback) {
        conf = "VERY_LOW";
        sourceDetail = "features_no_history";
      } else if (hFallback || aFallback) {
        conf = "LOW";
        sourceDetail = "features_partial";
      }

      // Edge cell boost
      const edge = edgeCells[`${cellKey}|${market}`];
      let edgeBoost = null;
      if (edge && featuresFromDB && !hFallback && !aFallback) {
        edgeBoost = { lift: edge.lift, min_lift: edge.min_lift, stability: edge.stability, n: edge.n };
        // Boost confidence if strong edge
        if (edge.lift >= 2.0 && edge.min_lift >= 1.2 && edge.stability >= 7) {
          conf = "HIGH";
          sourceDetail = `edge_cell (${edge.lift}x)`;
        }
      }

      predictions[market] = {
        p: Number(calP.toFixed(4)),
        confidence: conf,
        source: sourceDetail,
        cell: cellKey,
        edge_boost: edgeBoost,
      };
    }

    return new Response(JSON.stringify({
      fixture_id,
      match_date: fix.match_date,
      predictions,
      version: models.version,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});