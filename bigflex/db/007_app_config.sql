-- ============================================================================
-- Q&ANSR — app config persistence.
-- The AI-pipeline registry + provider keys (AES-256-GCM encrypted at rest) live
-- here as a single JSONB row so they survive ephemeral compute (Cloud Run).
-- Dev with no DB falls back to data/config.json; prod owns this row.
-- The encryption secret is NEVER stored here — it comes from CONFIG_SECRET (env
-- / Secret Manager). This row holds only ciphertext.
-- ============================================================================
create table if not exists app_config (
  id          int primary key default 1,
  data        jsonb not null,
  updated_at  timestamptz default now(),
  constraint app_config_singleton check (id = 1)
);
