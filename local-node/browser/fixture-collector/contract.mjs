import { createHash } from "node:crypto";

export const FIXTURE_CONTRACT =
  "CFI_BROWSER_FIXTURE_CANDIDATE_V1";

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function classifyCandidate(candidate) {
  const text = [
    candidate.competition,
    candidate.home_team,
    candidate.away_team
  ]
    .filter(Boolean)
    .join(" ");

  let gender = "UNKNOWN";

  if (
    /\b(women|ladies|female|feminine|femenino|feminino|wfc)\b/i.test(text)
  ) {
    gender = "WOMEN";
  }

  let age_band = "UNKNOWN";

  const age =
    text.match(/\bU[\s-]?(18|19|20|21|23)\b/i);

  if (age) {
    age_band = `U${age[1]}`;
  }

  let competition_class = "UNKNOWN";

  if (gender === "WOMEN") {
    competition_class = "WOMEN";
  } else if (age_band !== "UNKNOWN") {
    competition_class = "YOUTH";
  } else if (
    /\breserves?\b/i.test(text)
  ) {
    competition_class = "RESERVE";
  } else if (
    /\bsemi[\s-]?pro(?:fessional)?\b/i.test(text)
  ) {
    competition_class = "SEMI_PRO";
  } else if (
    /\bamateur\b/i.test(text)
  ) {
    competition_class = "AMATEUR";
  }

  return {
    gender,
    age_band,
    competition_class,
    classification_basis:
      competition_class === "UNKNOWN"
        ? "NO_EXPLICIT_MARKER"
        : "EXPLICIT_TEXT_MARKER"
  };
}

export function fixtureIdentity(candidate) {
  return createHash("sha256")
    .update(
      [
        normalizeText(candidate.home_team),
        normalizeText(candidate.away_team),
        candidate.kickoff_utc
      ].join("|")
    )
    .digest("hex");
}

export function validateCandidate(
  candidate,
  now = new Date()
) {
  const errors = [];

  if (
    !String(candidate.source_id ?? "").trim()
  ) {
    errors.push("MISSING_SOURCE_ID");
  }

  let sourceUrl = null;

  try {
    sourceUrl = new URL(
      String(candidate.source_url ?? "")
    );

    if (sourceUrl.protocol !== "https:") {
      errors.push("SOURCE_URL_NOT_HTTPS");
    }
  } catch {
    errors.push("INVALID_SOURCE_URL");
  }

  if (
    !String(candidate.home_team ?? "").trim()
  ) {
    errors.push("MISSING_HOME_TEAM");
  }

  if (
    !String(candidate.away_team ?? "").trim()
  ) {
    errors.push("MISSING_AWAY_TEAM");
  }

  if (
    normalizeText(candidate.home_team) &&
    normalizeText(candidate.home_team) ===
      normalizeText(candidate.away_team)
  ) {
    errors.push("HOME_EQUALS_AWAY");
  }

  const kickoff =
    new Date(candidate.kickoff_utc);

  if (
    !candidate.kickoff_utc ||
    Number.isNaN(kickoff.getTime())
  ) {
    errors.push("INVALID_KICKOFF_UTC");
  } else if (
    kickoff.getTime() <= now.getTime()
  ) {
    errors.push("NOT_PROSPECTIVE");
  }

  if (
    !String(candidate.competition ?? "").trim()
  ) {
    errors.push("MISSING_COMPETITION");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function normalizeCandidate(candidate) {
  const classification =
    classifyCandidate(candidate);

  const normalized = {
    contract: FIXTURE_CONTRACT,

    source_id:
      String(candidate.source_id).trim(),

    source_url:
      String(candidate.source_url).trim(),

    provider_id:
      candidate.provider_id == null
        ? null
        : String(candidate.provider_id).trim(),

    competition:
      String(candidate.competition).trim(),

    country:
      candidate.country == null
        ? null
        : String(candidate.country).trim(),

    home_team:
      String(candidate.home_team).trim(),

    away_team:
      String(candidate.away_team).trim(),

    kickoff_utc:
      new Date(
        candidate.kickoff_utc
      ).toISOString(),

    ...classification,

    evidence_tier:
      "C_BROWSER_VERIFIED",

    data_completeness:
      "FIXTURE_ONLY",

    predictionGenerated:
      false,

    oddsGenerated:
      false,

    resultGenerated:
      false,

    decisionUse:
      false
  };

  normalized.identity_key =
    fixtureIdentity(normalized);

  return normalized;
}
