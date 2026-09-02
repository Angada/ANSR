-- ============================================================================
-- Contra — "not assessed" must be sayable.
--
-- contra_review.issue_count was `integer NOT NULL DEFAULT 0`, so a review that
-- never ran had exactly one way to record itself: ZERO ISSUES. Combined with
-- /run writing status='done' regardless of whether the model was ever reached,
-- every failure mode — no API key, pipeline disabled in Admin, provider 429,
-- JSON truncated at max_tokens, an empty extract — produced a row that the UI
-- rendered as a green "clean" and that exported as a branded Word document
-- reading "0 issues flagged".
--
-- Every review in this database was written that way. NULL now means "we do not
-- know", which is the truth for all of them, and is a different thing from 0.
-- ============================================================================

alter table contra_review alter column issue_count drop not null;
alter table contra_review alter column issue_count drop default;

-- why a review is not trustworthy, in the row itself rather than inferred
alter table contra_review add column if not exists run_mode    text;   -- ai | stub | disabled | error
alter table contra_review add column if not exists run_note    text;   -- the provider's own words when it failed
alter table contra_review add column if not exists coverage    jsonb;  -- {sections_expected, sections_returned, rules_expected, rules_returned}
alter table contra_review add column if not exists unread_pages jsonb; -- pages the extractor could not read (scans/figures)

-- ONE-SHOT: retire the false-clean rows already on disk. They are not clean, they
-- were never assessed — every contra_log row in this estate's history reads
-- status='stub', so no Contra review has ever reached a model. Status becomes
-- 'not_assessed' and issue_count becomes NULL so nothing downstream can keep
-- reporting them as reviewed. The reports themselves are kept for the record.
do $$
begin
  if not exists (select 1 from schema_oneshot where key = '050_contra_false_clean') then
    update contra_review
       set status = 'not_assessed', issue_count = null,
           run_mode = coalesce(run_mode, 'unknown'),
           run_note = coalesce(run_note, 'Retired by migration 050: this review was recorded as done with 0 issues, but the estate has no record of any Contra AI call ever succeeding. Re-run it.')
     where status = 'done' and issue_count = 0
       and not exists (select 1 from jsonb_array_elements(coalesce(verdicts, '[]'::jsonb)) limit 1);
    insert into schema_oneshot(key) values ('050_contra_false_clean');
  end if;
end $$;
