# CFI Countdown Routing Contract

This contract is mandatory for screenshot-driven and user-driven match routing.

1. `COUNTDOWN TO KICKOFF`, a visible countdown timer, warm-up, scheduled/not-started, or a fixture starting within minutes is PREMATCH, never LIVE.
2. Countdown does not disable historical retrieval. Run the normal PREMATCH V5.2.5 strict-prior pipeline including canonical team resolution and HOME/AWAY/H2H history.
3. When the user did not type `target_date`, resolve the target fixture as the nearest upcoming kickoff consistent with the screenshot/countdown and the user's current local time. In ordinary countdown cases this is the current local date. If the countdown crosses local midnight, use the resulting next local date. Do not select a fixture several days away when a countdown indicates imminent kickoff.
4. Use the resolved kickoff date as `target_date` for `cfiPredictMatch`; all predictive evidence must still satisfy `fixtureDate < target_date` under the existing strict-prior contract.
5. Switch to CFI LIVE only with positive evidence that play has started: running match minute/period, current in-play score/state, or explicit LIVE indicator. Scheduled kickoff time having arrived is not by itself sufficient if the screen still shows pre-kickoff countdown/not-started state.
6. If exact-team retrieval unexpectedly returns 0/0/0 for an imminent known fixture, first treat it as canonical alias/entity-resolution/data-coverage failure. Do not silently replace match-specific evidence with global priors and do not output a normal production CFI FINAL as though exact-team history existed.
7. Screenshot statistics may become predictive evidence only if canonicalized, deduplicated, dated and provenance-tagged before a NEW prediction. Never retrofit a prediction after the engine has already run.
