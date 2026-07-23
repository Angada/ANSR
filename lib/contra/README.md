# Contra — transplantable contract-review components

Two drop-in components (plus a combined façade) that turn contracts into
reviewed, marked-up output. **No provider lock-in**: you inject one `llm`
function, so they run in any project on any model/gate you already have.

- **Contra-Archetype** (`archetype.js`) — learn a contract *type* from a sample:
  propose the review sections + suggest plain-English rules.
- **Contra-Contract** (`contract.js`) — detect a contract's type, run a holistic
  review (verdicts · rule-checks · whole-contract findings · redlines), answer
  grounded questions, and mark up the **original `.docx`** with tracked changes.
- **Contra-AC** (`index.js`) — both, as one object.

## The one thing you provide: `llm`

```js
// your gate — route to whatever model/provider you use (BYOK, a gateway, etc.)
async function llm({ system, user, maxTokens }) {
  const r = await myGateway.chat({ system, user, max_tokens: maxTokens });
  return r.text;              // return the model's raw text; Contra parses the JSON
}
```

For scanned PDFs, OCR is up to your host pipeline — feed Contra the extracted
text. (`prompts.js` exports `OCR_PROMPT` if you wire a vision model.)

## Use it

```js
import ContraAC from "@/lib/contra";

// 1) learn a type once (persist `archetype` however you like)
const archetype = await ContraAC.makeArchetype(sampleContractText, { llm });
// archetype = { name, review_outline:[{ key,label,what_to_check,required,rules:[{text}] }] }

// add your own review rules in plain English
ContraAC.addRule(archetype, "governing_law", "Governing law must be Bangalore, India");

// 2) review a new contract against it (one archetype, or up to a few — deduped)
const review = await ContraAC.review(contractText, archetype, { llm });
// review = { summary, parties, verdicts, rule_checks, findings, redlines, issue_count }

// 3a) mark up the ORIGINAL .docx with tracked-change redlines (needs jszip)
const { buffer, applied } = await ContraAC.markupDocx(originalDocxBuffer, review.redlines);
// 3b) or ask a grounded question
const answer = await ContraAC.ask(contractText, "Is liability adequately capped?", { llm });
```

## Attach at ingestion or exit

- **Ingestion hook** — when a document lands (upload / email / queue), if it's a
  contract: `detect()` its type, `review()` it, and store the result. Route
  first-of-a-new-type through `makeArchetype()` (human confirms) to grow your library.
- **Exit hook** — on the way out (download / send / sign), swap the plain file for
  `markupDocx()`'s tracked-change version, or attach the review report / findings.

## Notes
- Every model call is one `llm(...)` — log/meter/gate it in your `llm` wrapper.
- `redline.js` needs `jszip`. `markupDocx` only works on `.docx` sources
  (a PDF has no Word format to redline) — fall back to a report for those.
- Redlines whose `find` text spans runs or isn't verbatim are skipped + reported.
