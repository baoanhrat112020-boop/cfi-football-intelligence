import { createClient } from "npm:@supabase/supabase-js@2";

const MARKETS = ["3+ HT", "7+ FT", "Other HT", "Other FT"] as const;
const WEIGHTS = [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1] as const;
const PAGE_SIZE = 1000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const hit = (r: any, market: string) => market === "3+ HT"
  ? r.ht_home + r.ht_away >= 3
  : market === "7+ FT"
  ? r.ft_home + r.ft_away >= 7
  : market === "Other HT"
  ? r.ht_home >= 4 || r.ht_away >= 4
  : r.ft_home >= 5 || r.ft_away >= 5;

type LossAcc = { sum: number; n: number };
type MarketState = { priorN: number; priorHits: number; recent: number[]; loss: LossAcc[]; onlineSum: number; onlineN: number };
type SegmentState = { sampleSize: number; markets: Record<string, MarketState> };

function newMarketState(): MarketState {
  return { priorN: 0, priorHits: 0, recent: [], loss: WEIGHTS.map(() => ({ sum: 0, n: 0 })), onlineSum: 0, onlineN: 0 };
}
function newSegmentState(): SegmentState {
  return { sampleSize: 0, markets: Object.fromEntries(MARKETS.map((m) => [m, newMarketState()])) };
}
function avg(a: LossAcc) { return a.n > 0 ? a.sum / a.n : null; }
function observeRow(state: SegmentState, row: any) {
  state.sampleSize++;
  for (const market of MARKETS) {
    const s = state.markets[market];
    const y = hit(row, market) ? 1 : 0;
    if (s.priorN >= 20) {
      const A = (s.priorHits + 1.5) / (s.priorN + 7.5);
      const B = (s.recent.reduce((a, b) => a + b, 0) + 1) / (s.recent.length + 2);
      let chosen = .5;
      let best = Infinity;
      for (let i = 0; i < WEIGHTS.length; i++) {
        const a = s.loss[i];
        if (a.n >= 30) {
          const brier = a.sum / a.n;
          if (brier < best) { best = brier; chosen = WEIGHTS[i]; }
        }
      }
      const p = clamp(A * chosen + B * (1 - chosen));
      s.onlineSum += (p - y) ** 2;
      s.onlineN++;
      for (let i = 0; i < WEIGHTS.length; i++) {
        const w = WEIGHTS[i];
        const q = clamp(A * w + B * (1 - w));
        s.loss[i].sum += (q - y) ** 2;
        s.loss[i].n++;
      }
    }
    s.priorN++;
    s.priorHits += y;
    s.recent.push(y);
    if (s.recent.length > 20) s.recent.shift();
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST_REQUIRED" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "SERVER_SECRET_MISSING" }, 500);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: schedulerTokenRow, error: schedulerTokenError } = await db
    .from("cfi_scheduler_tokens")
    .select("token")
    .eq("token_name", "segment_calibration")
    .single();
  if (schedulerTokenError || !schedulerTokenRow?.token) return json({ error: "SCHEDULER_AUTH_NOT_CONFIGURED" }, 500);
  if (req.headers.get("x-cfi-scheduler-token") !== schedulerTokenRow.token) return json({ error: "UNAUTHORIZED_SCHEDULER" }, 401);

  const states = new Map<string, SegmentState>();
  let fixtureReadCount = 0;
  let pages = 0;
  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db.from("fixtures")
        .select("fixture_id,match_date,competition_segment,ht_home,ht_away,ft_home,ft_away")
        .not("competition_segment", "is", null)
        .not("ht_home", "is", null).not("ht_away", "is", null)
        .not("ft_home", "is", null).not("ft_away", "is", null)
        .order("competition_segment", { ascending: true })
        .order("match_date", { ascending: true })
        .order("fixture_id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data ?? [];
      pages++;
      for (const row of rows) {
        const segment = String((row as any).competition_segment || "");
        if (!segment) continue;
        let state = states.get(segment);
        if (!state) { state = newSegmentState(); states.set(segment, state); }
        observeRow(state, row);
        fixtureReadCount++;
      }
      if (rows.length < PAGE_SIZE) break;
    }
  } catch (e) {
    return json({ error: "READ_FAILED", message: e instanceof Error ? e.message : String(e), fixtureReadCount, pages }, 500);
  }

  const out: any[] = [];
  for (const [segment, state] of states) {
    const params: any = {};
    const segmentLoss: number[] = [];
    for (const market of MARKETS) {
      const s = state.markets[market];
      let bestIndex = 5;
      let bestBrier = Infinity;
      for (let i = 0; i < WEIGHTS.length; i++) {
        const b = avg(s.loss[i]);
        if (b !== null && b < bestBrier) { bestBrier = b; bestIndex = i; }
      }
      const weightA = WEIGHTS[bestIndex];
      const brier = Number.isFinite(bestBrier) ? bestBrier : null;
      params[market] = { weightA, weightB: 1 - weightA, brier, n: s.loss[bestIndex].n, onlineBrier: s.onlineN ? s.onlineSum / s.onlineN : null };
      if (brier !== null) segmentLoss.push(brier);
    }
    const version = `CFI_SEG_${segment}_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
    const brier = segmentLoss.length ? segmentLoss.reduce((a, b) => a + b, 0) / segmentLoss.length : null;
    const { error } = await db.from("cfi_segment_calibration_versions").insert({
      segment,
      calibration_version: version,
      parameters: { markets: params, strictPrior: true, method: "EXPANDING_VS_RECENT20_TOURNAMENT_STREAMING", fixtureReadCount, pagination: `${PAGE_SIZE}x${pages}`, complexity: "O(Nx11)", deterministicOrder: "competition_segment,match_date,fixture_id" },
      sample_size: state.sampleSize,
      brier,
      status: "CHALLENGER",
    });
    if (error) out.push({ segment, status: "WRITE_FAILED", message: error.message });
    else out.push({ segment, status: "CHALLENGER", sampleSize: state.sampleSize, brier, parameters: params, version });
  }
  return json({ status: "COMPLETED", learner: "CFI_SEGMENT_LEARNER_V1.2_STREAMING", strictPrior: true, fixtureReadCount, pages, segmentCount: states.size, segments: out });
});
