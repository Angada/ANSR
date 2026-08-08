-- Q-Legal · TYPE-SCOPED standing questions, grouped into SETS.
-- Estate-wide questions (governing law, liability cap…) apply to everything.
-- A SET is the bundle a legal team keeps per contract type — "NDA · India",
-- "MSA & Services", "Lease", "Staffing" — so a reviewer opens a contract, sees
-- the set that matches its type recommended, and runs it in one click.
-- doc_types scopes which contracts a question is offered for.
-- Idempotent: safe on every boot, never overwrites an edited question.

alter table ql_register add column if not exists set_name text;
create index if not exists ql_register_set_idx on ql_register(set_name);

insert into ql_register (code, name, question, extract_hint, doc_types, set_name, builtin) values

  -- ---- NDA / MNDA (India) -------------------------------------------------
  ('nda-in-term', 'Confidentiality term (India)',
   'For how long do the confidentiality obligations survive — during the term and how many years after? Is there a perpetual carve-out for trade secrets?',
   'the survival period, e.g. "3 years post-termination; perpetual for trade secrets"',
   '["NDA","MNDA"]', 'NDA & MNDA', true),
  ('nda-in-stamp', 'Stamping & registration (India)',
   'Does the agreement record stamp duty, the state of stamping, or a registration requirement?',
   'the state and stamp value, or "not stated"', '["NDA","MNDA","Lease"]', 'NDA & MNDA', true),
  ('nda-permitted', 'Permitted disclosures',
   'Who may the receiving party disclose to (affiliates, employees, advisors, sub-contractors), and must they be bound by equivalent terms?',
   'the permitted recipients', '["NDA","MNDA"]', 'NDA & MNDA', true),
  ('nda-return', 'Return or destruction',
   'On termination, must confidential information be returned or destroyed, within how many days, and is a certificate of destruction required? Are archival/backup copies permitted?',
   'the deadline and whether a certificate is required', '["NDA","MNDA"]', 'NDA & MNDA', true),
  ('nda-injunctive', 'Injunctive relief',
   'Does the agreement entitle the disclosing party to injunctive or equitable relief without proving damages or posting security?',
   'yes/no and any bond waiver', '["NDA","MNDA"]', 'NDA & MNDA', true),
  ('nda-residuals', 'Residuals clause',
   'Is there a residuals clause allowing use of information retained in unaided memory? (Common in US forms, unusual and risky in Indian ones.)',
   'the residuals wording if present', '["NDA","MNDA"]', 'NDA & MNDA', true),
  ('nda-mutual', 'Mutual or one-way',
   'Do the confidentiality obligations bind both parties equally (mutual) or only one side (one-way)?',
   'mutual / one-way, and which side is bound', '["NDA","MNDA"]', 'NDA & MNDA', true),

  -- ---- MSA / Services ------------------------------------------------------
  ('msa-ip', 'IP ownership & licence',
   'Who owns the deliverables and any foreground IP, what background IP does each side retain, and what licence is granted to the other?',
   'who owns deliverables + the licence granted', '["MSA","Services","SOW","SaaS"]', 'MSA & Services', true),
  ('msa-payment', 'Payment terms',
   'What are the payment terms — invoicing frequency, net days, currency, interest on late payment, and any right to suspend for non-payment?',
   'the net days and late-payment interest', '["MSA","Services","SOW","SaaS","Staffing Contract"]', 'MSA & Services', true),
  ('msa-sla', 'Service levels & credits',
   'Are service levels defined, and do they carry service credits, earn-back, or a right to terminate for chronic failure?',
   'the SLA target and the credit regime', '["MSA","Services","SOW","SaaS"]', 'MSA & Services', true),
  ('msa-subcontract', 'Subcontracting & offshoring',
   'May the provider subcontract or perform work offshore, does that need consent, and does the provider stay liable for subcontractors?',
   'whether consent is needed and who stays liable', '["MSA","Services","SOW","Staffing Contract"]', 'MSA & Services', true),
  ('msa-audit', 'Audit rights',
   'May the client audit the provider (books, security, compliance), on what notice, how often, and who bears the cost?',
   'the notice period and frequency', '["MSA","Services","SOW","SaaS"]', 'MSA & Services', true),
  ('msa-warranty', 'Warranties & remedies',
   'What warranties does the provider give on the services or deliverables, for how long, and what is the remedy for breach (re-perform, refund)?',
   'the warranty period and remedy', '["MSA","Services","SOW"]', 'MSA & Services', true),
  ('msa-change', 'Change control',
   'How are changes to scope, rates or timelines agreed — a written change order, and may either party refuse?',
   'the change mechanism', '["MSA","Services","SOW"]', 'MSA & Services', true),

  -- ---- Lease ---------------------------------------------------------------
  ('lease-lockin', 'Lock-in & exit',
   'Is there a lock-in period, what notice is needed to vacate, and what does early exit cost?',
   'the lock-in and notice period', '["Lease"]', 'Lease', true),
  ('lease-rent', 'Rent, escalation & CAM',
   'What is the rent, how often does it escalate and by how much, and what maintenance/CAM or other charges are payable on top?',
   'the rent, escalation % and CAM', '["Lease"]', 'Lease', true),
  ('lease-deposit', 'Security deposit',
   'What security deposit is payable, on what terms is it refundable, and within how many days of vacating?',
   'the deposit amount and refund window', '["Lease"]', 'Lease', true),
  ('lease-repair', 'Repairs & fit-out',
   'Who is responsible for structural repairs, interior maintenance and fit-out, and must the premises be restored on exit?',
   'who repairs what, and any restoration duty', '["Lease"]', 'Lease', true),
  ('lease-quiet', 'Quiet enjoyment & lessor covenants',
   'Does the lessor covenant quiet enjoyment, clear title, and payment of property tax/statutory dues?',
   'the lessor covenants given', '["Lease"]', 'Lease', true),

  -- ---- Staffing / Recruitment ---------------------------------------------
  ('staff-checks', 'Background checks & onboarding',
   'What background verification, medical checks or onboarding conditions must personnel clear, and within what time?',
   'the checks required and the deadline', '["Staffing Contract","Recruitment","ATS"]', 'Staffing & Recruitment', true),
  ('staff-replace', 'Replacement & free-replacement window',
   'If a placed person leaves or is rejected, is there a replacement obligation or a free-replacement/refund window, and how long?',
   'the replacement window', '["Staffing Contract","Recruitment"]', 'Staffing & Recruitment', true),
  ('staff-rates', 'Rate card & fee basis',
   'How is the fee calculated — percentage of CTC, fixed fee, or rate card — and what triggers it (offer, joining, or completion)?',
   'the fee basis and trigger', '["Staffing Contract","Recruitment"]', 'Staffing & Recruitment', true),
  ('staff-compliance', 'Statutory compliance (PF/ESI/labour)',
   'Who bears responsibility for PF, ESI, gratuity, minimum wages and other statutory dues for deployed personnel, and is proof of compliance required?',
   'who is responsible and what proof is required', '["Staffing Contract","Recruitment"]', 'Staffing & Recruitment', true),
  ('staff-noengage', 'Direct-hire / poaching restriction',
   'May the client directly hire a deployed or referred candidate, and does that trigger a fee or a restriction period?',
   'the restriction and any conversion fee', '["Staffing Contract","Recruitment"]', 'Staffing & Recruitment', true)

on conflict (code) do nothing;
