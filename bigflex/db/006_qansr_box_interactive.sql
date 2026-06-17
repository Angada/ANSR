-- ============================================================================
-- Q&ANSR interactive boxes — esp. the "Rule book & formulas" box.
-- Each box supports: AI explain (box.ai_explain) + clarification chat
-- (box_chat) + AI suggestions + user amendments (box_suggestion below).
-- Accepting a suggestion bumps box.version, updates the compiled rule_version,
-- and writes audit_log — so the rule book is co-authored (AI + human) with a trail.
-- ============================================================================

create table if not exists box_suggestion (
  id            serial primary key,
  box_id        int references box(id),
  kind          text not null,                 -- ai_suggestion | user_amendment | clarification
  proposed_by   text not null,                 -- ai | user
  summary       text,                          -- "Tighten CTC: exclude joining bonus per §2.4"
  before_json   jsonb, after_json jsonb,        -- the proposed change to box.content / rule
  rationale     text, clause_ref text, confidence numeric(4,3),
  status        text default 'open',            -- open | accepted | rejected | applied
  decided_by    text, decided_at timestamptz,
  created_at    timestamptz default now()
);

create index if not exists box_suggestion_box on box_suggestion(box_id, status);
