-- Q-Legal · Drafts — AI drafting modelled on the estate's own contracts.
-- Flow: NL ask → the repo SUGGESTS suitable model contracts (multiple) → the
-- lawyer selects → draft 1 is generated complete (structure + standard positions
-- come from the chosen models, particulars from the ask). Idempotent.
create table if not exists ql_draft (
  id bigserial primary key,
  ask text not null,
  model_ids jsonb not null default '[]'::jsonb,   -- the chosen model contract ids
  draft_md text,
  status text not null default 'draft',           -- draft | error
  created_at timestamptz not null default now()
);
