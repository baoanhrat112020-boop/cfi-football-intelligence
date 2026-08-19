# CFI Image Match-State Contract v1.0

## Purpose
Prevent screenshot clock/countdown misclassification from contaminating strict-prior prediction and audit workflows.

## Mandatory classification
Every screenshot that contains a fixture header MUST be assigned exactly one state before its football data is interpreted:

- `PRE_MATCH`
- `KICKOFF_COUNTDOWN`
- `LIVE_IN_PLAY`
- `HALF_TIME`
- `FINISHED`
- `UNKNOWN`

The classifier MUST NOT infer `LIVE_IN_PLAY` from UI labels such as `Live`, `Match Live`, red dots, chat badges, animated icons, or bookmaker availability alone.

## Clock semantics
### Countdown to kickoff
A centered clock formatted `HH:MM:SS` (examples `00:05:05`, `00:07:37`) in a pre-match fixture header MUST be treated as `KICKOFF_COUNTDOWN` when there is no positive evidence that play has started.

Interpretation:
- `00:05:05` = 305 seconds remaining until kickoff.
- `00:07:37` = 457 seconds remaining until kickoff.
- It MUST NOT be converted to minute 5 or minute 7 of the match.

### Positive evidence required for LIVE_IN_PLAY
Classify `LIVE_IN_PLAY` only when at least one reliable in-play signal exists, for example:
- elapsed football clock/minute such as `5'`, `45+2'`, `67'`;
- explicit period state (`1H`, `2H`) combined with elapsed match time;
- confirmed match event already recorded (goal/card/substitution/etc.) with in-play context;
- score/event state that unambiguously proves kickoff occurred.

If evidence conflicts, use `UNKNOWN` and do not silently assume live.

## Strict-prior rule
`PRE_MATCH` and `KICKOFF_COUNTDOWN` screenshots are valid pre-match evidence when captured before kickoff. They MUST NOT be rejected merely because the source UI displays `Live` or `Match Live`.

`LIVE_IN_PLAY`, `HALF_TIME`, and `FINISHED` evidence MUST NOT be allowed to alter an immutable strict-prior pre-match prediction.

## Required extraction fields
Image extraction should expose:

```json
{
  "matchState": "PRE_MATCH|KICKOFF_COUNTDOWN|LIVE_IN_PLAY|HALF_TIME|FINISHED|UNKNOWN",
  "clockInterpretation": "countdown_to_kickoff|elapsed_match_time|unavailable",
  "displayedClock": "00:05:05",
  "timeToKickoffSeconds": 305,
  "elapsedMatchSeconds": null,
  "strictPriorEligible": true,
  "stateEvidence": ["HH:MM:SS countdown", "no confirmed in-play event"]
}
```

## Safety invariant
When uncertain whether a clock is countdown or elapsed time, CFI MUST NOT invent match minutes. Return `UNKNOWN` and preserve the screenshot for review.

## Regression cases
1. `00:05:05` + `Match Live` + no in-play event => `KICKOFF_COUNTDOWN`, 305 seconds, strict-prior eligible.
2. `00:07:37` + `Match Live` + no in-play event => `KICKOFF_COUNTDOWN`, 457 seconds, strict-prior eligible.
3. `5'` + first-half context => `LIVE_IN_PLAY`.
4. `67'` + second-half context => `LIVE_IN_PLAY`.
5. `HT` => `HALF_TIME`.
6. `FT` => `FINISHED`.
7. Conflicting/insufficient clock evidence => `UNKNOWN`.
