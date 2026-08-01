-- Q-Legal — business rules become OPERATING CONTROLS, not prose principles.
--
-- The old seeds ("SharePoint is the source of truth", "propose, never silently
-- decide") were architectural INVARIANTS wearing a rule's clothes: they can't be
-- switched off (Q-Legal has no write scope on SharePoint by construction; the
-- confirm queue IS the code path), so a toggle beside them was a lie. They are
-- stated in the app as non-negotiables instead.
--
-- A business rule here is now what it is in RayDar: the dials that actually
-- change how a step runs — how much of a contract each step reads, the
-- confidence below which something goes to the confirm queue, the similarity at
-- which two documents are the same contract, how many documents Ask opens —
-- plus the editable prompt that step runs through.

alter table ql_rule add column if not exists params jsonb not null default '{}'::jsonb;
alter table ql_rule add column if not exists explain text;      -- what this lever controls, in plain English

-- retire the prose seeds (invariants, not controls) — leaves any human-authored rule alone
delete from ql_rule where code in
  ('source-of-truth','grounding','confirm-dont-guess','lazy-versioning','tag-vocabulary','notice-extraction','obligation-reminders');

-- the real levers, one per pipeline step. body = the prompt guidance injected at
-- call time; params = the numbers the code actually reads (server/qlegal.js).
insert into ql_rule (code, title, explain, body, scope, params) values
  ('c1-read', 'Comprehensive read (C1)',
   'How much of each file is transcribed, and when a scan is routed to vision-OCR instead of the text layer. Raising the cap costs more on very long contracts; lowering it truncates them.',
   'Transcribe faithfully and completely — every heading, clause, number, date, amount and table cell, in reading order. Never summarise or omit.',
   'ingestion',
   '{"max_transcript_chars":400000,"ocr_fallback":true,"ocr_when_text_under_chars":60}'::jsonb),

  ('c2-key', 'Concise key + contents & clause wikis (C2)',
   'The indexing step every query later runs on. read_chars is how much of the transcript the model sees; classify_confidence_min is the bar below which a classification goes to the Confirm queue instead of being applied.',
   'Extract only what the document states — never infer or invent. Empty string when not stated. Use the § references exactly as the document prints them. Prefer an existing tag over a near-duplicate new one.',
   'ingestion',
   '{"read_chars":60000,"max_tokens":4000,"classify_confidence_min":0.7,"max_clauses":400,"max_contents":300}'::jsonb),

  ('obligations', 'Obligation extraction',
   'What lands in the task list: how much is read, the cap per contract, and the default lead time on a dated obligation before it shows as due.',
   'Extract the obligations a legal/ops team must track — dated lifecycle events (expiry, renewal window, termination notice) AND post-execution deliverables/SLAs. Only what the contract states, each with its § reference.',
   'obligations',
   '{"read_chars":50000,"max_tokens":2500,"max_per_contract":60,"default_lead_days":30}'::jsonb),

  ('registers', 'Standing questions (registers)',
   'The estate-wide answering step. sweep_batch is how many contracts one backfill pass answers; a human-corrected answer is never overwritten by re-extraction.',
   'Answer each standing question for THIS contract only, from its actual text, citing the § for every "yes". Say "no" when the contract genuinely does not deal with it, "unclear" when ambiguous — never guess a "yes".',
   'registers',
   '{"read_chars":50000,"max_tokens":3000,"sweep_batch":25,"keep_corrected":true}'::jsonb),

  ('families', 'Document families & lineage',
   'How the doc tree is proposed. lineage_similarity_min is the text-overlap at which two documents are called the same contract (draft ↔ executed); require_explicit_reference stops parents being guessed from topic similarity alone.',
   'Propose a parent ONLY when the document itself references it (by name, date, or parties). Return null when there is no explicit tell-tale — topic similarity alone is never enough.',
   'ingestion',
   '{"candidates_considered":200,"lineage_similarity_min":0.85,"require_explicit_reference":true}'::jsonb),

  ('ask', 'Ask — the retrieval ladder',
   'How wide and deep a question is answered. documents_read is how many contracts get opened, deep_text_chars how much of each is read, semantic_candidates how many vector hits are considered before fusion.',
   'Answer only from the provided repository context. Cite the document name AND the § for every claim. If the context cannot answer, say exactly what is missing and suggest adding it as a standing question — never guess.',
   'search',
   '{"documents_read":4,"semantic_candidates":12,"deep_text_chars":10000,"register_answers":400,"history_turns":4,"obligations_horizon_days":120,"max_tokens":1500}'::jsonb),

  ('vectors', 'Semantic spine (vectors)',
   'The meaning index behind search, Ask, nearest-in-estate and the Estate map. Granularities decide what is embedded; the caps bound cost per contract.',
   '',
   'vectors',
   '{"granularities":["document","section","clause"],"max_clause_vectors":240,"max_section_vectors":80,"nearest_in_estate":5,"embed_batch":48}'::jsonb),

  ('drafting', 'Drafting from model contracts',
   'candidates_ranked is how much of the estate is considered as models; max_models is how many a lawyer can base a draft on; model_read_chars is how much of each model is read for structure and standard positions.',
   'Model contracts define structure and standard positions; the ask defines particulars. Draft complete and precise, in the house voice — never invent facts, bracket what is unknown as [PLACEHOLDERS].',
   'drafting',
   '{"candidates_ranked":15,"max_models":3,"model_read_chars":20000,"max_tokens":8000}'::jsonb),

  ('sharepoint-scan', 'SharePoint scan',
   'The read-only scanner: when the nightly run fires (IST), which file types are picked up, and whether a file that disappeared is proposed inactive in the Confirm queue.',
   '',
   'sync',
   '{"nightly_hour_ist":2,"file_types":[".pdf",".docx",".doc",".txt",".md"],"removal_detection":true,"max_files_per_scan":200}'::jsonb)
on conflict (code) do nothing;
