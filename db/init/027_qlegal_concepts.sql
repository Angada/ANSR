-- Q-Legal · Legal concepts (the search thesaurus) + scan-completeness report.
-- A concept maps ONE legal idea to ALL the words contracts use for it, so a
-- search for "governing law" also finds "choice of law", "venue", "seat of
-- arbitration"… — concept-based retrieval, not keyword luck. Editable and
-- growing (Taxonomy screen), like every other vocabulary here. Idempotent.

create table if not exists ql_concept (
  id bigserial primary key,
  name text unique not null,                     -- the concept, e.g. "Governing law & jurisdiction"
  terms jsonb not null default '[]'::jsonb,      -- every phrasing that means it
  builtin boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

insert into ql_concept (name, terms, builtin) values
  ('Governing law & jurisdiction', '["governing law","applicable law","choice of law","venue","forum selection","courts of competent jurisdiction","exclusive jurisdiction","non-exclusive jurisdiction","dispute resolution","disputes","arbitration","seat of arbitration","place of arbitration","arbitral","mediation","conciliation","forum","courts of","subject to the jurisdiction","construed in accordance with"]', true),
  ('Limitation of liability', '["limitation of liability","liability cap","aggregate liability","consequential damages","indirect damages","special damages","loss of profits","cap on liability","maximum liability"]', true),
  ('Indemnity', '["indemnify","indemnity","indemnification","hold harmless","defend and hold","third party claims"]', true),
  ('Termination', '["termination","terminate","for convenience","without cause","for cause","cure period","notice period","expiry","expiration","early exit","wind down"]', true),
  ('Confidentiality', '["confidential","confidentiality","non-disclosure","nda","proprietary information","trade secret"]', true),
  ('Data protection', '["data protection","personal data","data breach","security incident","gdpr","dpdp","data privacy","processor","controller","sub-processor","data subject"]', true),
  ('Assignment & change of control', '["assignment","assign","change of control","change in control","merger","acquisition","novation","transfer of rights","successor"]', true),
  ('Non-solicitation', '["non-solicit","non-solicitation","solicit","no-hire","no hire","poach","non-compete","non-competition"]', true),
  ('Insurance', '["insurance","insure","policy of insurance","professional indemnity","commercial general liability","workers compensation","cyber liability","certificate of insurance"]', true),
  ('Force majeure', '["force majeure","act of god","beyond reasonable control","epidemic","pandemic","natural disaster"]', true),
  ('Payment terms', '["payment terms","net 30","net 45","net 60","invoice","late payment","interest on overdue","fees","charges","taxes","withholding"]', true),
  ('Intellectual property', '["intellectual property","ip rights","work product","ownership of deliverables","license","licence","copyright","patent","trademark","moral rights","background ip","foreground ip"]', true),
  ('Notices', '["notices","notice clause","registered post","courier","email notice","service of notice","notify"]', true)
on conflict (name) do nothing;

-- what the reader actually managed on each version: pages, OCR'd pages, figure
-- pages, and — loudly — pages it could NOT read
alter table ql_version add column if not exists read_report jsonb;

-- the estate-wide standing question the feedback asked for, as a built-in register
insert into ql_register (code, name, question, extract_hint, builtin) values
  ('governing-law-disputes', 'Governing law & disputes',
   'What law governs this contract, which courts or venue have jurisdiction (exclusive or non-exclusive), and is there an arbitration or other dispute-resolution mechanism (institution, rules, seat/place)? Capture ANY clause that determines applicable law, forum, venue, court jurisdiction or dispute resolution, whatever its heading — including Applicable Law, Choice of Law, Venue, Forum Selection, Courts of Competent Jurisdiction, Arbitration Seat/Place.',
   'law + forum/venue + arbitration seat, e.g. "India · exclusive courts of Bangalore · SIAC arbitration, Singapore seat"', true)
on conflict (code) do nothing;
