-- ============================================================================
-- Q&ANSR date/time normalization layer.
-- Excel dates are the messiest input: serial numbers, dd/mm vs mm/dd ambiguity,
-- text, blanks, #N/A. These dates DRIVE billing (milestone months + OSS month-end
-- active HC), so a misread = wrong invoice. Store raw + normalized + format +
-- flags; resolve locale ambiguity ONCE per source via a persisted decision.
-- ============================================================================

-- contract/business timezone — OSS month-end ("no pro-rata") is measured here so
-- a join/exit on a boundary day lands in the correct billing month.
alter table customer add column if not exists tz text default 'Asia/Kolkata';

-- per-document detected date format + locale (the resolved ambiguity).
alter table document add column if not exists date_format text;   -- 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'EXCEL_SERIAL' | 'ISO' | 'mixed'
alter table document add column if not exists date_locale text;    -- 'IN' | 'US' | ...

-- placement: keep the raw verbatim alongside the normalized date + flags.
alter table placement add column if not exists sourcing_date_raw text;
alter table placement add column if not exists offer_date_raw    text;
alter table placement add column if not exists join_date_raw      text;
alter table placement add column if not exists exit_date_raw      text;
alter table placement add column if not exists date_format        text;  -- format applied to this row
alter table placement add column if not exists date_flags         jsonb; -- ['join_ambiguous','exit_missing','sourcing_unparseable']

-- date-format resolution is persisted like any other normalization decision:
-- decision.topic = 'date_format:<doc_id or customer>' , choice = 'DD/MM/YYYY' ...
-- unparseable / ambiguous-and-unresolved values raise an exception_item:
--   issue ∈ missing_join_date | unparseable_date | ambiguous_date
-- so they surface for natural-language fix before the run is processed.
