# 7 · Mint user journey — the walkthrough

[← API reference](06-api-reference.md) · [Wiki home](README.md) · Next: [Deployment →](08-deployment.md)

---

What a user actually does, start to finish. Mint is presented as a **numbered run** with a vertical step flow (see the `qansr-ops-design` skill).

## Step 0 — Pick or create a client
- The Mint hub lists existing contracts (Kenvue, etc.). Click one to recall its history, or **Create New** (inline line-entry, no popup).
- Creating a client writes a `customer` row + an `audit_log` entry.

## Step 1 — Upload the contract (SOW)
- Drag in a PDF/DOCX/XLSX/TXT. It lands in the **vault (T1)**, an **md extract (T2)** is made, and a `document` row is written.
- AI reads it and fills the **analysis boxes** — company, legal, payment terms, commercial terms, caveats, flags, and the key **Rule book & formulas** box.
- Each box has: an AI explanation, a clause citation, a confidence, and a **chat** to clarify/amend. You approve each.

## Step 2 — Confirm the rule book
- The **Rule book** box is the executable heart. Review the rate table, slabs, milestones, normalizers.
- Ask AI to clarify or suggest; accept/reject amendments (each bumps the version + recompiles).
- **Worked examples self-test** must pass (the trust gate) — this proves the engine reproduces the contract's own examples before you rely on it.
- A light-purple **Recalibrate** animation re-derives rules from any corrections, with a live meter, and prints **plain-language bullets** of what the engine now understands + what it still needs from the worksheet.

## Step 3 — Atlas pre-flight (automatic)
- On generate, Mint routes the contract through **Atlas**. If it matches a known **archetype**, the rule book is **pre-loaded from the family template** — you mostly confirm deltas.
- **Epidemiology pre-warnings** appear: "contracts like this usually trip on X — here's the fix."
- **Federation** has already pre-filled label decisions that sibling contracts agreed on, so you'll see fewer questions.

## Step 4 — Provide the worksheet (the data feed)
- Upload the monthly employee Excel **or** point Mint at an **API** (rows[] or a URL).
- Mint maps columns (AI + deterministic), you confirm the mapping, and rows are written to the **placement ledger** (raw kept verbatim; cumulative across months).

## Step 5 — Compute
- Mint computes the clean rows immediately → **TA** and **OSS** lines, each with a full **trace**.
- Result shows: **computed N · exceptions M · clarifications K**.
- **Exceptions** (rows that can't be safely billed — missing date, missing CTC, duplicate) are quarantined and listed with a reason.
- **Clarifications** appear as purple AI chips: a question + AI-suggested answer + options + a free-text box.

## Step 6 — The clarification loop
- Answer a clarification once (click or type) → it saves as a **decision** that **auto-applies to every affected row and every future run** — and **promotes across the archetype** (federation).
- Only the affected rows recompute, live; the exception/clarification counts drop. No full reload, clean rows never blocked.

## Step 7 — Release & outputs
- **Release** freezes the run into an immutable `statement`.
- Outputs:
  - **Invoice** — ANSR-branded A4 PDF.
  - **Months** — month-by-month breakdown.
  - **Calc** — every number with its step trail + ask-chips.
  - **Charts / filterable bill** — KPIs, stacked trend, cost-head donut, filter by month/head.
- Cray-cray extras: **invoice replay slider** (reveal calc steps in order), **confidence heat map**, **audit pack**.

## Step 8 — Ask questions (grounded chat)
- Ask "why is March OSS $64,130?" → the chat answers from the **trace** (121 active heads × $530, slab 51–250, §4.2) with the source rows.
- Corrections you make in chat become interpretations/decisions and **ground every future answer** (and promote across the archetype).

---

## What's saved (for audit)
Everything: clients, docs (original + extract), runs, calc facts, traces, exceptions, decisions, clauses, interpretations, FX rates, and an append-only `audit_log`. Every number traces back to its clause and the original file.
