export type MarketCode = "3+ HT" | "7+ FT" | "Other HT" | "Other FT";

export type HistoricalFixture = {
  matchDate: string;
  htHome: number;
  htAway: number;
  ftHome: number;
  ftAway: number;
  weight?: number;
};

export type PredictionInput = {
  targetDate: string;
  homeHistory: HistoricalFixture[];
  awayHistory: HistoricalFixture[];
  h2hHistory?: HistoricalFixture[];
};

export type MarketPrediction = {
  market: MarketCode;
  optionA: { method: "EMPIRICAL_BAYES"; probability: number };
  optionB: { method: "POISSON_STRUCTURAL"; probability: number };
  selectedMethod: "EMPIRICAL_BAYES" | "POISSON_STRUCTURAL" | "BLEND";
  selectedProbability: number;
  evidenceCount: number;
  dataQuality: "INSUFFICIENT" | "PARTIAL" | "GOOD";
};

const MARKETS: MarketCode[] = ["3+ HT", "7+ FT", "Other HT", "Other FT"];

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function hit(f: HistoricalFixture, market: MarketCode): number {
  if (market === "3+ HT") return f.htHome + f.htAway >= 3 ? 1 : 0;
  if (market === "7+ FT") return f.ftHome + f.ftAway >= 7 ? 1 : 0;
  if (market === "Other HT") return Math.max(f.htHome, f.htAway) >= 4 ? 1 : 0;
  return Math.max(f.ftHome, f.ftAway) >= 5 ? 1 : 0;
}

function priorOnly(rows: HistoricalFixture[], targetDate: string) {
  return rows
    .filter((x) => x.matchDate < targetDate)
    .filter((x) => [x.htHome, x.htAway, x.ftHome, x.ftAway].every(Number.isInteger))
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate));
}

function recencyWeight(index: number, length: number) {
  const age = length - 1 - index;
  return Math.pow(0.94, age);
}

function weightedRows(input: PredictionInput) {
  const home = priorOnly(input.homeHistory, input.targetDate);
  const away = priorOnly(input.awayHistory, input.targetDate);
  const h2h = priorOnly(input.h2hHistory ?? [], input.targetDate);
  const output: Array<{ fixture: HistoricalFixture; weight: number }> = [];
  home.forEach((fixture, i) => output.push({ fixture, weight: 1.0 * recencyWeight(i, home.length) }));
  away.forEach((fixture, i) => output.push({ fixture, weight: 1.0 * recencyWeight(i, away.length) }));
  h2h.forEach((fixture, i) => output.push({ fixture, weight: 1.35 * recencyWeight(i, h2h.length) }));
  return output;
}

function empiricalBayes(input: PredictionInput, market: MarketCode) {
  const rows = weightedRows(input);
  const alpha0 = 1.5;
  const beta0 = 6.0;
  let hits = 0;
  let total = 0;
  for (const row of rows) {
    hits += hit(row.fixture, market) * row.weight;
    total += row.weight;
  }
  return { probability: (alpha0 + hits) / (alpha0 + beta0 + total), count: rows.length };
}

function poissonCdf(k: number, lambda: number) {
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    sum += term;
  }
  return clamp01(sum);
}

function weightedMean(values: Array<{ value: number; weight: number }>) {
  const denom = values.reduce((s, x) => s + x.weight, 0);
  if (!denom) return 0;
  return values.reduce((s, x) => s + x.value * x.weight, 0) / denom;
}

function structuralPoisson(input: PredictionInput, market: MarketCode) {
  const rows = weightedRows(input);
  const htLambda = weightedMean(rows.map((x) => ({ value: x.fixture.htHome + x.fixture.htAway, weight: x.weight })));
  const ftLambda = weightedMean(rows.map((x) => ({ value: x.fixture.ftHome + x.fixture.ftAway, weight: x.weight })));
  const htHomeLambda = weightedMean(rows.map((x) => ({ value: x.fixture.htHome, weight: x.weight })));
  const htAwayLambda = weightedMean(rows.map((x) => ({ value: x.fixture.htAway, weight: x.weight })));
  const ftHomeLambda = weightedMean(rows.map((x) => ({ value: x.fixture.ftHome, weight: x.weight })));
  const ftAwayLambda = weightedMean(rows.map((x) => ({ value: x.fixture.ftAway, weight: x.weight })));

  if (!rows.length) return { probability: 0, count: 0 };
  if (market === "3+ HT") return { probability: 1 - poissonCdf(2, htLambda), count: rows.length };
  if (market === "7+ FT") return { probability: 1 - poissonCdf(6, ftLambda), count: rows.length };
  if (market === "Other HT") {
    const noHome4 = poissonCdf(3, htHomeLambda);
    const noAway4 = poissonCdf(3, htAwayLambda);
    return { probability: 1 - noHome4 * noAway4, count: rows.length };
  }
  const noHome5 = poissonCdf(4, ftHomeLambda);
  const noAway5 = poissonCdf(4, ftAwayLambda);
  return { probability: 1 - noHome5 * noAway5, count: rows.length };
}

function brier(predictions: number[], outcomes: number[]) {
  if (!predictions.length) return Number.POSITIVE_INFINITY;
  return predictions.reduce((sum, p, i) => sum + Math.pow(p - outcomes[i], 2), 0) / predictions.length;
}

function walkForwardScore(input: PredictionInput, market: MarketCode, method: "EMPIRICAL_BAYES" | "POISSON_STRUCTURAL") {
  const all = [...input.homeHistory, ...input.awayHistory, ...(input.h2hHistory ?? [])]
    .filter((x) => x.matchDate < input.targetDate)
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  if (all.length < 12) return Number.POSITIVE_INFINITY;
  const preds: number[] = [];
  const outcomes: number[] = [];
  for (let i = 8; i < all.length; i++) {
    const cutoff = all[i].matchDate;
    const train = all.slice(0, i);
    const wf: PredictionInput = { targetDate: cutoff, homeHistory: train, awayHistory: [], h2hHistory: [] };
    const pred = method === "EMPIRICAL_BAYES" ? empiricalBayes(wf, market).probability : structuralPoisson(wf, market).probability;
    preds.push(pred);
    outcomes.push(hit(all[i], market));
  }
  return brier(preds, outcomes);
}

export function predictFourMarkets(input: PredictionInput): MarketPrediction[] {
  return MARKETS.map((market) => {
    const a = empiricalBayes(input, market);
    const b = structuralPoisson(input, market);
    const scoreA = walkForwardScore(input, market, "EMPIRICAL_BAYES");
    const scoreB = walkForwardScore(input, market, "POISSON_STRUCTURAL");
    let selectedMethod: MarketPrediction["selectedMethod"] = "BLEND";
    let selectedProbability = (a.probability + b.probability) / 2;

    if (Number.isFinite(scoreA) && Number.isFinite(scoreB)) {
      if (Math.abs(scoreA - scoreB) > 0.015) {
        if (scoreA < scoreB) {
          selectedMethod = "EMPIRICAL_BAYES";
          selectedProbability = a.probability;
        } else {
          selectedMethod = "POISSON_STRUCTURAL";
          selectedProbability = b.probability;
        }
      } else {
        const wa = 1 / Math.max(scoreA, 0.01);
        const wb = 1 / Math.max(scoreB, 0.01);
        selectedProbability = (a.probability * wa + b.probability * wb) / (wa + wb);
      }
    }

    const count = Math.max(a.count, b.count);
    return {
      market,
      optionA: { method: "EMPIRICAL_BAYES", probability: clamp01(a.probability) },
      optionB: { method: "POISSON_STRUCTURAL", probability: clamp01(b.probability) },
      selectedMethod,
      selectedProbability: clamp01(selectedProbability),
      evidenceCount: count,
      dataQuality: count < 8 ? "INSUFFICIENT" : count < 24 ? "PARTIAL" : "GOOD",
    };
  });
}
