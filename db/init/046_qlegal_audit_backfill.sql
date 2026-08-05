-- ============================================================================
-- Q-Legal — backfill the audit trail from Q-Legal's OWN dated records.
--
-- The HTTP audit middleware sat below mountQLegal until 05-08-2026, so no
-- request from Q-Legal was ever recorded. Those rows cannot be recovered —
-- they were never written.
--
-- But Q-Legal kept its own history, with real timestamps: every gated AI call
-- (ql_log), every document and version ingested, and every confirm-queue
-- decision. Those ARE the events an auditor cares about, so they are replayed
-- into audit_log at their original time.
--
-- Honesty markers, so a reconstructed row is never mistaken for a live one:
--   · actor is 'qlegal-backfill' where the real actor was never recorded
--   · detail carries "backfilled": true and the source table
--   · method is null — these were never HTTP requests
-- Idempotent: keyed on a deterministic path per source row.
-- ============================================================================

-- 1 · every gated AI call Q-Legal made
insert into audit_log (at, actor, role, app, action, path, status, ms, object_type, detail)
select l.created_at,
       'qlegal-backfill', null, 'qlegal',
       'pipeline.' || coalesce(l.status, 'unknown'),
       '/backfill/ql_log/' || l.id,
       case when l.status = 'ok' then 200 else 500 end,
       null, 'pipeline',
       jsonb_build_object('backfilled', true, 'source', 'ql_log',
         'pipeline', l.pipeline, 'provider', l.provider, 'model', l.model,
         'ref_type', l.ref_type, 'ref_id', l.ref_id,
         'rules_applied', to_jsonb(coalesce(l.rules_applied, '{}')),
         'input', left(coalesce(l.input_summary, ''), 200),
         'output', left(coalesce(l.output_summary, ''), 200),
         'input_tokens', l.input_tokens, 'output_tokens', l.output_tokens, 'cost_usd', l.cost_usd)
  from ql_log l
 where not exists (select 1 from audit_log a where a.path = '/backfill/ql_log/' || l.id);

-- 2 · every document that entered the repository
insert into audit_log (at, actor, role, app, action, path, status, object_type, detail)
select d.created_at, 'qlegal-backfill', null, 'qlegal', 'document.ingested',
       '/backfill/ql_document/' || d.id, 200, 'document',
       jsonb_build_object('backfilled', true, 'source', 'ql_document',
         'document_id', d.id, 'filename', d.filename, 'title', d.title,
         'doc_type', d.doc_type, 'counterparty', d.counterparty)
  from ql_document d
 where not exists (select 1 from audit_log a where a.path = '/backfill/ql_document/' || d.id);

-- 3 · every version processed (the C1/C2 read)
insert into audit_log (at, actor, role, app, action, path, status, object_type, detail)
select v.created_at, 'qlegal-backfill', null, 'qlegal', 'version.processed',
       '/backfill/ql_version/' || v.id, 200, 'version',
       jsonb_build_object('backfilled', true, 'source', 'ql_version',
         'version_id', v.id, 'document_id', v.document_id)
  from ql_version v
 where not exists (select 1 from audit_log a where a.path = '/backfill/ql_version/' || v.id);

-- 4 · every confirm-queue decision — the one place a HUMAN acted, so the real
--     resolver is used as the actor when Q-Legal recorded one
insert into audit_log (at, actor, role, app, action, path, status, object_type, detail)
select coalesce(c.resolved_at, c.created_at),
       coalesce(nullif(c.resolved_by, ''), 'qlegal-backfill'), null, 'qlegal',
       'confirm.' || coalesce(c.status, 'open'),
       '/backfill/ql_confirm/' || c.id, 200, 'confirm',
       jsonb_build_object('backfilled', true, 'source', 'ql_confirm',
         'confirm_id', c.id, 'kind', c.kind, 'document_id', c.document_id,
         'confidence', c.confidence, 'why', left(coalesce(c.why, ''), 200))
  from ql_confirm c
 where not exists (select 1 from audit_log a where a.path = '/backfill/ql_confirm/' || c.id);
