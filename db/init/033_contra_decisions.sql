-- Contra — a decision on a review must CHANGE something and TEACH something.
--
-- The defect (CONFIRM-QUEUE.md §7): accept/reject on a review section wrote a row
-- to the change timeline and nothing else. It resolved no finding, suppressed
-- nothing on the next contract, and taught the archetype nothing — a comment log
-- wearing the clothes of a decision. Q-Legal had decisions without context;
-- Contra had context without consequence.
--
--   contra_decision — one row per human verdict on a specific section or finding.
--                     `verdict` accept|reject, `reason` the learning label.
--                     Keyed by (review, box_key, finding_key) so a decision is
--                     about a THING, not about a moment in a timeline.
--
-- The teaching signal: the same rejection reason recurring across contracts OF
-- THE SAME ARCHETYPE means the archetype's rule is wrong, not the contract. That
-- is surfaced for a human to act on — never auto-applied.

create table if not exists contra_decision (
  id bigserial primary key,
  review_id bigint not null references contra_review(id) on delete cascade,
  archetype_id bigint,                             -- denormalised: the teaching signal groups by this
  box_key text,                                    -- the review section
  finding_key text,                                -- a specific finding/rule within it (null = the section itself)
  verdict text not null,                           -- accept | reject
  reason text,
  actor text,
  created_at timestamptz not null default now(),
  unique (review_id, box_key, finding_key)
);
create index if not exists contra_decision_arch_idx on contra_decision(archetype_id, verdict);
create index if not exists contra_decision_review_idx on contra_decision(review_id);
