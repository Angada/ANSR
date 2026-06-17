-- ============================================================================
-- Atlas — the contract archetype library (BigFlex meta-learning layer).
-- Each contract gets a structured FINGERPRINT (its billing physiology). Similar
-- fingerprints crystallise into ARCHETYPES that carry a reusable rule-book
-- template + operators + required inputs + normalizer dictionaries + a playbook.
-- A new contract is routed to an archetype (or seeds a new one) → the journey
-- starts pre-loaded. Cross-contract learning lives here.
-- ============================================================================

create table if not exists archetype (
  id            serial primary key,
  slug          text unique not null,          -- 'split-fee+headcount-slab'
  name          text,
  version       int default 1,
  fingerprint   jsonb,                          -- centroid signals
  rule_template jsonb,                          -- canonical rule book skeleton
  operators     text[],                         -- operator kinds it needs
  required_inputs jsonb,                        -- worksheet fields it expects
  normalizers   jsonb,                          -- shared label→canonical dicts (federated)
  playbook_md   text,                           -- the journey runbook (human-readable)
  exception_patterns jsonb,                     -- recurring exceptions to preempt
  stats         jsonb default '{}'::jsonb,      -- {members, avg_confidence, clarifications_per}
  status        text default 'active',          -- active | draft | retired
  created_by    text default 'atlas', created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists contract_fingerprint (
  id            serial primary key,
  customer_id   int references customer(id),
  archetype_id  int references archetype(id),
  signals       jsonb not null,                 -- this contract's fingerprint
  similarity    numeric(5,4),                   -- to the chosen archetype
  decision      text,                           -- matched | partial | novel
  candidates    jsonb,                          -- [{archetype_id, slug, sim}] considered
  confidence    numeric(5,4),
  decided_by    text default 'atlas', created_at timestamptz default now(),
  unique(customer_id)
);
create index if not exists cfp_arch on contract_fingerprint(archetype_id);

-- federated normalizer mappings with a promotion ladder (contract→archetype→global)
create table if not exists norm_federation (
  id            serial primary key,
  scope         text not null,                  -- contract | archetype | global
  scope_ref     text,                           -- customer code / archetype slug / null
  layer         text not null,                  -- source | level | status
  raw_label     text not null,
  canonical     text not null,
  votes         int default 1,                  -- support count
  conflicts     int default 0,                  -- disagreements seen
  status        text default 'proposed',        -- proposed | promoted | conflicted
  updated_at    timestamptz default now(),
  unique(scope, scope_ref, layer, raw_label)
);
