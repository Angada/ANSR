-- Munshi-for-Mint: contract corpus → atomic clause-referenced rule-chips.
-- Idempotent (re-applied every boot). See docs/13-munshi-for-mint.md.

-- the corpus: SOW + amendments + clarifications + prior invoices
create table if not exists mint_contract_doc (
  id           serial primary key,
  customer_code text not null,
  kind         text default 'sow',          -- sow | amendment | clarification | invoice
  name         text,
  md           text,                          -- extracted markdown
  source_hash  text,
  created_at   timestamptz default now()
);

-- atomic rule-chips (each TA row / OSS slab / milestone / caveat / flag = one chip)
create table if not exists mint_contract_chip (
  id           serial primary key,
  customer_code text not null,
  box_type     text not null,                 -- company | legal | payment_terms | commercial_terms | billing_rules | caveats | flags
  key          text not null,                 -- stable atomic key within the box
  value        jsonb,
  weight       numeric default 0.8,           -- confidence
  clause_ref   text,
  provenance   jsonb default '{}'::jsonb,      -- {doc, span, hash}
  status       text default 'draft',          -- draft | confirmed
  source_hash  text,                           -- hash of the source chunk it came from
  updated_at   timestamptz default now(),
  unique(customer_code, box_type, key)
);
create index if not exists mint_chip_cust on mint_contract_chip(customer_code, box_type);
