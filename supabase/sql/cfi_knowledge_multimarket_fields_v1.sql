-- Extend the research-only Knowledge Registry for Multi-Market Hunt V1.
-- Existing knowledge remains untouched; new fields are additive.

alter table public.cfi_knowledge_registry
  add column if not exists multi_market_relevance_score integer null check (multi_market_relevance_score is null or (multi_market_relevance_score between 0 and 100)),
  add column if not exists target_market text null check (target_market is null or target_market in ('P1_OVER_UNDER','P2_ASIAN_HANDICAP','P3_JOINT_COHERENCE','P4_ONE_X_TWO','P5_MARKET_VALUE','P6_UNCERTAINTY','P7_FOUNDATIONAL')),
  add column if not exists required_artifacts jsonb not null default '[]'::jsonb check (jsonb_typeof(required_artifacts)='array'),
  add column if not exists expected_failure_modes jsonb not null default '[]'::jsonb check (jsonb_typeof(expected_failure_modes)='array'),
  add column if not exists baseline_lock text not null default 'R0_IMMUTABLE' check (baseline_lock='R0_IMMUTABLE'),
  add column if not exists hunt_score numeric null check (hunt_score is null or (hunt_score between 0 and 100));

comment on column public.cfi_knowledge_registry.multi_market_relevance_score is 'CFI Multi-Market Hunt relevance score; new queue candidates require >=70.';
comment on column public.cfi_knowledge_registry.target_market is 'Priority track P1-P7 for Multi-Market Knowledge Hunt V1.';
comment on column public.cfi_knowledge_registry.required_artifacts is 'Artifacts required before an honest CFI Lab experiment can run.';
comment on column public.cfi_knowledge_registry.expected_failure_modes is 'Known transfer/evaluation failure modes; never interpreted as evidence of benefit.';
comment on column public.cfi_knowledge_registry.baseline_lock is 'Always R0_IMMUTABLE for research candidates.';
