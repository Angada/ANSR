-- ============================================================================
-- Munshi-for-Mint — the living contract corpus + atomic rule-chips.
-- Upgrades Mint's parser from "one SOW → fixed boxes" to a corpus (SOW +
-- amendments + side-letters + clarifications) parsed into typed, weighted,
-- provenance-backed CHIPS that re-derive on amendment. The 7 fixed boxes are
-- kept as *groupings* of chips (the calc engine still reads the rule tables).
-- Method: Munshi (RayDar clientmind-parse). Format: Mint's structured boxes.
-- See docs/13-munshi-for-mint.md. Ships behind the MINT_PARSER flag.
-- ============================================================================

-- ---- corpus membership: a thin role/ordering layer over the vault `document` --
-- The original files live in `document` (T1 vault + T2 md extract). contract_doc
-- records each doc's ROLE in the contract corpus and how it supersedes others,
-- so a whole living contract = its ordered set of docs.
create table if not exists contract_doc (
  id            serial primary key,
  customer_id   int references customer(id) on delete cascade,
  document_id   int references document(id),   -- the vaulted original (nullable for md-only)
  doc_id        text,                          -- the docstore id ('sow-ab12cd', 'amend-…') — T2 key
  role          text not null default 'primary_sow',
                -- primary_sow | amendment | side_letter | clarification | prior_invoice | other
  title         text,
  effective_date date,                         -- when this doc's terms take effect
  supersedes_id int references contract_doc(id),-- an amendment can supersede an earlier doc
  ord           int default 0,                 -- corpus order (primary first, then by effective_date)
  source_hash   text,                          -- sha256 of the whole md extract (skip re-parse if unchanged)
  status        text default 'active',         -- active | superseded | removed
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(customer_id, doc_id)
);
create index if not exists contract_doc_cust on contract_doc(customer_id, ord);

-- ---- chunks: every doc chunked by clause with a content hash ------------------
-- The unit of re-parse-on-change. On a new/edited doc we hash each chunk and
-- re-parse ONLY the chunks whose hash changed (idempotent delta). Verbatim body
-- is kept as legal authority; chips cite chunk → clause → doc span.
create table if not exists contract_chunk (
  id             serial primary key,
  customer_id    int references customer(id) on delete cascade,
  contract_doc_id int references contract_doc(id) on delete cascade,
  ref            text not null,                -- '§3.1' (stable within its doc)
  title          text,
  body           text,                         -- verbatim clause markdown
  ord            int,
  chunk_hash     text not null,                -- sha256(ref+title+body) — the change detector
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique(contract_doc_id, ref)
);
create index if not exists contract_chunk_cust on contract_chunk(customer_id);
create index if not exists contract_chunk_hash on contract_chunk(chunk_hash);

-- ---- chips: atomic, weighted, provenance-backed rule facts --------------------
-- Munshi-analogue of wh_client_mind, but STRUCTURED (not loose): each chip is one
-- atomic fact (a single TA rate row, an OSS slab, a milestone, a caveat, a
-- company field). box_type groups chips into the 7 boxes. value.kind tells the
-- assembler how to fold a chip back into the executable rule book.
--   key       — deterministic identity within (customer, box_type) → idempotent upsert / delta
--   value     — {kind, ...fact}: scalar|field|rate_row|slab|milestone|worked_example|note
--   provenance— {doc_id, contract_doc_id, chunk_hash, span} → traces every number to source
--   status    — draft (AI proposed) | confirmed (human-locked) | superseded (kept for lineage)
-- A confirmed chip is NEVER overwritten by re-parse; a changed source forks a new
-- draft chip and the old confirmed one is surfaced, not clobbered (see server/munshi).
create table if not exists contract_chip (
  id            serial primary key,
  customer_id   int references customer(id) on delete cascade,
  box_type      text not null,                 -- company|legal|payment_terms|commercial_terms|billing_rules|caveats|flags
  key           text not null,                 -- 'ta_rate:band=≤100|level=non_leadership|referral=f'
  value         jsonb not null,                -- {kind, ...} the atomic fact
  confidence    numeric(4,3),                  -- 0..1 weight/trust
  clause_ref    text,                          -- '§3.1' (human-readable citation)
  provenance    jsonb default '{}'::jsonb,     -- {doc_id, contract_doc_id, chunk_hash, span}
  status        text default 'draft',          -- draft | confirmed | superseded
  source_hash   text,                          -- chunk_hash the chip was derived from (re-parse guard)
  ord           int default 0,                 -- order within its box
  run_id        int,                           -- the intake run that produced it
  created_by    text default 'ai',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(customer_id, box_type, key)           -- latest current chip; history via audit_log
);
create index if not exists contract_chip_cust on contract_chip(customer_id, box_type, ord);
create index if not exists contract_chip_status on contract_chip(customer_id, status);
create index if not exists contract_chip_gin on contract_chip using gin (value);
