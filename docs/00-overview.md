# 0 · Overview — what Q&ANSR / Mint is

[← Wiki home](README.md) · Next: [Architecture →](01-architecture.md)

---

## The problem

You have contracts. Each one says, in its own words, how to bill a client. Kenvue's contract says: *"charge a recruitment fee (TA) as a % of salary, split across 3 milestones; plus a monthly operations fee (OSS) based on headcount."*

The naive way to handle 1000 contracts is to write 1000 little programs — one per client's rules. That doesn't scale.

## The core trick: rules are *data*, not *code*

- The **code** only knows a tiny set of generic math operations (the **operators**).
- Each **contract** is just a structured description (the **rule book**) that tells the code which operators to run, in what order, with what numbers.

Adding contract #1001 means adding *data*, not writing *code*. The same engine runs all of them.

One hard rule: **if the engine hits something the operators can't express, it stops and asks a human. It never guesses.** ("Flag, don't guess.")

## The two ingredients per contract

1. **A document** — the SOW/contract. Defines the *rules*.
2. **A periodic data feed** — the monthly employee worksheet (Excel file *or* an API). Supplies the *data* (who was hired, salary, dates).

> **document (rules) + feed (data) → computed bill + full audit trail.**

## The two revenue lines (Kenvue example)

- **TA (Talent Acquisition) fee** — a one-time recruitment fee, `% of CTC` by level × band × referral, **split across 3 milestones** (sourcing, acceptance, balance) that fall in different months.
- **OSS (Operations) fee** — a recurring monthly fee based on **active headcount**, picked from a slab table (≤50 → minimum fee, 51–250 → per-resource rate). No pro-rata.

Both are just `cost_heads` in the rule book — `one_time_split` and `recurring_slab`. A different contract is a different set of cost_heads. Same engine.

## What you get out

- An **ANSR-branded A4 invoice (PDF)**.
- **Month-by-month** breakdown.
- **Detailed calc** — every number with its step trail.
- **Statement & charts** — KPIs, trend, cost-head donut, filterable bill.
- A **grounded Q&A chat** — ask "why is this number X?" and get the clause + calc behind it.

## Why it scales — the two layers

1. **BigFlex** (the engine): one engine, any contract; every number explainable; corrections become reusable decisions. → [BigFlex engine](02-bigflex-engine.md)
2. **Atlas** (the brain): contracts are sorted into **archetypes** (families that bill the same way). Each contract that runs makes the *next one of its shape* cheaper to onboard — it learns labels, failures, shape-drift, and matching across the family. → [Atlas](03-atlas.md)

**Mental model:**
- *BigFlex* = "rules are data, code is just operators, flag don't guess." One engine, any contract.
- *Atlas* = "every contract teaches the next one." Archetypes are families; learning promotes across the family.
