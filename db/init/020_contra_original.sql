-- Contra — keep the original uploaded file so a .docx can be marked up in place
-- (tracked-change redlines) while preserving its exact format. Additive.
alter table contra_review add column if not exists original_file bytea;
alter table contra_review add column if not exists original_ext text;
alter table contra_review add column if not exists party1 text;
alter table contra_review add column if not exists party2 text;
