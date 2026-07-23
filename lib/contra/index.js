/* Contra-AC — the two components as one façade. Learn a contract TYPE once
   (Contra-Archetype), then review contracts against it (Contra-Contract).
   Everything runs on a host-injected `llm`, so the whole thing is portable.

     import ContraAC from "@/lib/contra";
     // learn a type from a sample:
     const archetype = await ContraAC.makeArchetype(sampleText, { llm });
     // review a new contract against it:
     const review = await ContraAC.review(contractText, archetype, { llm });
     // or both at once:
     const { archetype, review } = await ContraAC.learnAndReview(sample, target, { llm });
     // mark up the original .docx with the review's redlines:
     const { buffer } = await ContraAC.markupDocx(originalDocxBuf, review.redlines);
*/
export * as Archetype from "./archetype.js";
export * as Contract from "./contract.js";
export { markupDocx } from "./redline.js";
export * from "./prompts.js";

import { makeArchetype, addRule } from "./archetype.js";
import { detect, review, ask, dedupOutlines, markupDocx } from "./contract.js";

export const ContraAC = {
  // Contra-Archetype
  makeArchetype, addRule,
  // Contra-Contract
  detect, review, ask, dedupOutlines, markupDocx,
  // end-to-end convenience
  async learnAndReview(sampleText, targetText, { llm } = {}) {
    const archetype = await makeArchetype(sampleText, { llm });
    const rev = await review(targetText, archetype, { llm });
    return { archetype, review: rev };
  },
};

export default ContraAC;
