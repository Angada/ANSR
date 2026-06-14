-- ============================================================================
-- Q&ANSR Contract Aggregator — portfolio billing + explainable forecast.
-- Actuals = released runs rolled up across all customers (FX-normalized to base).
-- Forecast = driver-based projection; every forecast line keeps its REASONS
-- (forecast_driver) so the number is explainable, like the invoice trace.
-- ============================================================================

create table if not exists forecast (
  id            serial primary key,
  customer_id   int references customer(id),   -- null = portfolio-wide
  as_of_month   text not null,                 -- when the forecast was made 'YYYY-MM'
  horizon_month text not null,                 -- the month being projected
  metric        text not null,                 -- ta | oss | credit | total
  scenario      text default 'base',           -- base | best | worst
  amount        numeric(14,2), ccy text,
  amount_base   numeric(14,2), base_ccy text, fx_rate_id int references fx_rate(id),
  confidence    numeric(4,3),
  created_at    timestamptz default now(),
  unique(customer_id, as_of_month, horizon_month, metric, scenario)
);

-- the "reason for forecast" — each driver's contribution to a forecast line.
create table if not exists forecast_driver (
  id            serial primary key,
  forecast_id   int references forecast(id),
  driver        text not null,                 -- pipeline_acceptance|pipeline_balance|oss_runrate|
                                               -- milestone|rate_change|churn_clawback|seasonality|manual
  contribution  numeric(14,2),                 -- amount this driver adds (base ccy)
  basis         text,                          -- "11 candidates in offer × 0.8 conv × avg $X"
  assumptions   jsonb,                          -- {conv_rate, avg_ctc, hc_growth, ...}
  source_ref    jsonb                           -- placements / runs / rule_versions used
);

-- portfolio actuals roll-up (released runs across all customers).
create or replace view portfolio_billing as
  select s.invoice_month, s.currency,
         sum(s.total_oss)   as total_oss,
         sum(s.total_ta)    as total_ta,
         sum(s.grand_total) as grand_total,
         count(distinct s.customer_id) as customers
  from statement s
  join run r on r.id = s.run_id and r.status = 'complete'
  group by s.invoice_month, s.currency;
