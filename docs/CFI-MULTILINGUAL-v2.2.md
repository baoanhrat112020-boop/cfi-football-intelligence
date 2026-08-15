# CFI v2.2 — Multilingual Presentation Layer

## Goal

Provide user-selectable presentation languages without duplicating or translating canonical football data.

CFI keeps one intelligence core and one Persistent Database. Language affects only presentation: UI labels, explanations, warnings, summaries and conclusions.

## Supported languages

Auto, Tiếng Việt, English, 中文, 日本語, 한국어, Español, Português, Français, Deutsch, Italiano, ไทย, Bahasa Indonesia.

## Selection

Use `CFI LANGUAGE <code|name>`.

Examples:

- `CFI LANGUAGE VI`
- `CFI LANGUAGE EN`
- `CFI LANGUAGE AUTO`

`AUTO` uses the user's detected/request language when supported; otherwise the presentation fallback is English.

## Frozen data behavior

Never translate or mutate canonical identifiers for presentation purposes. In particular:

- team `canonical_name`
- fixture identity
- league/provider IDs
- market codes `3+ HT`, `7+ FT`, `Other HT`, `Other FT`
- ingest states `NEW`, `DUPLICATE_COMPATIBLE`, `COMPLEMENTARY`, `CONFLICT`, `REJECTED`

This prevents language selection from breaking team identity resolution, H2H lookups, deduplication or database indexes.

## Persistence contract

A caller may store a tiny user preference such as `{ "language": "vi" }`. Do not create per-language fixture databases or translated copies of canonical fixture rows.

## Performance

Language resolution is an in-memory lookup. It adds no database join to the canonical fixture hot path and no extra fixture storage.

## Integration rule

All prediction/data services return structured canonical facts first. The presentation layer converts only human-facing labels and prose at the final response boundary.

This keeps CSV ingestion, screenshot merge, historical backfill, current refresh and prediction evidence language-neutral.
