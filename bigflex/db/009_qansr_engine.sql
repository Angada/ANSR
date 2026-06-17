-- Calc-engine support. placement keeps the RAW mapped row so a run can
-- re-normalize with the latest decisions (the clarification loop) deterministically.
alter table placement add column if not exists raw jsonb;
alter table placement add column if not exists invoice_month text;
create index if not exists placement_cust on placement(customer_id);
create index if not exists placement_dates on placement(customer_id, join_date, exit_date);

-- compiled rule book lives in rule_version.logic (already exists). Ensure a fast lookup.
create index if not exists rule_version_cust on rule_version(customer_id, rule_code, version_no);

-- decisions already exist (customer_id, topic unique). clarifications are derived
-- at compute time from normalize() + compute exceptions; resolved → decision row.
