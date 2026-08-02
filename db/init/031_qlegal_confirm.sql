-- Q-Legal — the confirm queue becomes a decision surface (CONFIRM-QUEUE.md).
--
-- The defect this fixes: rejection did not stick. `sweep/families` re-examined any
-- document whose confirms were all status<>'rejected', and classification
-- re-proposed whenever no OPEN row existed — so a rejected proposal was re-made on
-- the very next sweep, forever. That silently broke the "every decision teaches the
-- system" promise the app prints on its own screen.
--
--   proposal_key — the identity of WHAT was proposed (kind + the value), so a
--                  rejection can suppress exactly that proposal and nothing else.
--                  A different parent, or a different doc_type, is a new question
--                  and is still allowed to be asked.
--   reason       — why a human said no. This is the learning label; the same reason
--                  recurring across documents is a candidate business rule.
--   blocked      — this row is a SYSTEM FAILURE (no keyed model, extraction error),
--                  not a judgement call. Kept out of the decision list so fake
--                  0%-confidence rows stop poisoning trust in the real proposals.

alter table ql_confirm add column if not exists proposal_key text;
alter table ql_confirm add column if not exists reason text;
alter table ql_confirm add column if not exists blocked boolean not null default false;

-- suppression lookup: "has this exact proposal already been rejected here?"
create index if not exists ql_confirm_key_idx on ql_confirm(document_id, kind, proposal_key, status);
-- the decision list reads open + not-blocked, ordered by consequence
create index if not exists ql_confirm_open_kind_idx on ql_confirm(status, blocked, kind);

-- Backfill: existing rows that were the "no keyed model" placeholder are system
-- failures, not proposals — reclassify them so they leave the decision list.
update ql_confirm set blocked = true
 where status='open' and kind='classification' and coalesce(confidence,0) = 0
   and why ilike '%no keyed model%';
