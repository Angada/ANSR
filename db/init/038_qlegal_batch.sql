-- Ingestion as a persistent, server-owned job.
--
-- Until now a 40-contract upload lived in the browser: the tab drove the loop,
-- so closing it killed the run, a reload lost the progress, and the only report
-- was one dialog at the very end. A batch that cannot survive a refresh is not a
-- pipeline, it is a page doing work.
create table if not exists ql_batch (
  id          bigserial primary key,
  label       text,
  total       int not null default 0,
  status      text not null default 'running',   -- running | done | failed
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per file, carrying its own state machine. The list IS the progress
-- meter: you can see which document is being read right now, which are queued
-- behind it, and which stopped and why — instead of a percentage that explains
-- nothing when it stalls.
create table if not exists ql_batch_item (
  id           bigserial primary key,
  batch_id     bigint not null references ql_batch(id) on delete cascade,
  filename     text not null,
  sha256       text,
  document_id  bigint,
  -- queued -> reading (C1) -> atomizing -> keying (C2) -> done
  --                                     \-> blocked (gate) | failed | duplicate
  stage        text not null default 'queued',
  status       text not null default 'pending',  -- pending | ok | blocked | failed | duplicate
  gate         jsonb,                            -- the clarification verdict + notes
  decision     text,                             -- accept | reject (human, on a blocked item)
  decided_at   timestamptz,
  note         text,
  ord          int not null default 0,
  updated_at   timestamptz not null default now()
);
create index if not exists ql_batch_item_b_idx on ql_batch_item(batch_id, ord);
create index if not exists ql_batch_open_idx   on ql_batch_item(batch_id) where status = 'blocked';
